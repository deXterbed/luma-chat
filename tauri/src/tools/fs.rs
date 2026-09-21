//! Read-only file tools for Codebase mode (see `plan.md`).
//!
//! Three tools — `read_file`, `search_code`, `list_dir` — plus
//! `validate_project_root`, which gates the attach flow.
//!
//! **The attached root set is the only readable boundary.** The model supplies
//! *relative* paths only; every one is joined to a root, canonicalized, and
//! checked component-wise against that root. There is no tool that widens the
//! set — only the user attaching a folder does.
//!
//! **Everything here is a pure function over `&[PathBuf]`**, with no Tauri
//! context, so the guard is unit-testable. The `commands.rs` wrappers only add
//! `spawn_blocking`.
//!
//! ## The `Error:` prefix is load-bearing
//!
//! `runToolCalls` (frontend) marks a call failed when its result *starts with
//! the bare word `Error`* — no colon required — and a round where every call
//! failed jumps the session straight to its wrap-up round. A wrong path is
//! normal while exploring a repo, so every expected failure here ("not found",
//! "outside the root", "is a directory", "binary", "past EOF", "timed out") is
//! returned as a plain **observation** the model can read and correct. Only
//! genuine infrastructure failures (I/O errors) get the `Error:` prefix.

use std::fs::File;
use std::io::{BufRead, BufReader, ErrorKind};
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant};

use grep_regex::RegexMatcherBuilder;
use grep_searcher::{sinks, BinaryDetection, SearcherBuilder};
use ignore::overrides::OverrideBuilder;
use ignore::WalkBuilder;

/// Lines returned when the caller doesn't ask for a window.
const READ_DEFAULT_LIMIT: usize = 2000;
const READ_MAX_LIMIT: usize = 2000;
/// Hard per-line cap, applied *while reading*. Never `read_to_string` and then
/// truncate: one minified line can otherwise exhaust memory before the cap is
/// looked at.
const READ_MAX_LINE_CHARS: usize = 2000;
/// Byte budget for a single `read_file` result. The line caps alone still admit
/// ~4 MB, and this result lands in the transcript *and* in `messages.tool_calls`.
const READ_MAX_OUTPUT_CHARS: usize = 150_000;
/// Matches returned per file in `content` mode — without it one generated file
/// eats the whole budget.
const SEARCH_MAX_PER_FILE: usize = 20;
const SEARCH_MAX_TOTAL: usize = 100;
const SEARCH_COUNT_LISTED: usize = 20;
const LIST_MAX_ENTRIES: usize = 500;
/// A wrong root can otherwise hang the app. Checked *inside* the walk, so a
/// timeout returns partial results instead of leaving a thread running.
const SEARCH_TIMEOUT: Duration = Duration::from_secs(15);

// -----------------------------------------------------------------------------
// Path guard
// -----------------------------------------------------------------------------

/// Why a relative path or root was refused. Every variant renders as an
/// observation — see the module docs on the `Error:` prefix.
enum Refusal {
    NotRelative(String),
    RootMissing(String),
    NotFound(String),
    SymlinkEscape(String),
}

impl Refusal {
    fn message(&self) -> String {
        match self {
            Refusal::NotRelative(p) => format!(
                "Paths must be relative to the project root, but got {:?}. Use a path like src/lib/fs.rs.",
                p
            ),
            Refusal::RootMissing(label) => format!(
                "The attached project folder ({}) is no longer there — it was moved, renamed, or deleted. Re-attach it.",
                label
            ),
            Refusal::NotFound(p) => format!(
                "Not found: {:?} (relative to the project root). Use list_dir to see what is there.",
                p
            ),
            Refusal::SymlinkEscape(p) => format!(
                "Not readable: {:?} resolves outside the project root through a symlink. Symlinks that leave the attached folder are refused; attach the symlink's target as an additional root to read it.",
                p
            ),
        }
    }
}

/// A path proven to live inside one of the attached roots.
struct Resolved {
    root_index: usize,
    /// Canonical — the real file, symlinks already followed.
    canonical: PathBuf,
    /// Root-relative path for display (`src/lib/fs.rs`); `.` for the root.
    display: String,
}

/// The attached roots, canonicalized once per call.
///
/// Canonicalizing the *roots* here (not just the target) is what makes the
/// prefix check work for a symlinked root — otherwise the root fails
/// `starts_with` against its own children.
struct RootSet {
    raw: Vec<PathBuf>,
    canonical: Vec<PathBuf>,
}

impl RootSet {
    fn new(raw: &[PathBuf]) -> RootSet {
        let mut canonical: Vec<PathBuf> = Vec::new();
        for r in raw {
            let Ok(c) = dunce::canonicalize(r) else {
                continue; // gone or unreadable — kept in `raw` for the message
            };
            // Never treat the filesystem root as a project root, even if a
            // stale or hand-edited value says so. The attach-time validation
            // refuses it too; this is the cheap second line of defence.
            if c.parent().is_none() {
                continue;
            }
            // Overlapping roots double-cover files and duplicate search hits.
            // First attached wins, so the primary root is never displaced.
            if canonical
                .iter()
                .any(|kept| c.starts_with(kept) || kept.starts_with(&c))
            {
                continue;
            }
            canonical.push(c);
        }
        RootSet {
            raw: raw.to_vec(),
            canonical,
        }
    }

    /// Short label from the folder's basename — never the absolute path, which
    /// leaks `$HOME` into tool results and transcripts.
    fn label(&self, index: usize) -> String {
        self.raw
            .get(index)
            .map(|p| basename(p))
            .unwrap_or_else(|| "unknown".to_string())
    }

    /// Alias for a kept root, disambiguated by its parent when two roots share
    /// a basename. Surfaced in results so a multi-root hit isn't ambiguous.
    fn alias(&self, index: usize) -> String {
        let base = basename(&self.canonical[index]);
        let collides = self
            .canonical
            .iter()
            .filter(|p| basename(p) == base)
            .count()
            > 1;
        if collides {
            if let Some(parent) = self.canonical[index].parent() {
                if let Some(parent) = parent.parent() {
                    return format!("{}/{}", basename(parent), base);
                }
            }
        }
        base
    }
}

fn basename(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

/// Resolve a model-supplied relative path against the **primary** attached root.
///
/// Absolute paths and `..` are refused outright; the canonical, component-wise
/// prefix check is the real guard. A path that exists but canonicalizes outside
/// its root got there through a symlink, and is reported as such rather than as
/// a bare "outside the root" — the difference matters to anyone with a
/// workspace layout that links packages in from elsewhere.
fn resolve(roots: &RootSet, rel: &str) -> Result<Resolved, Refusal> {
    // Relative paths resolve against the **primary** root only. A flat namespace
    // where `src/index.ts` could mean either of two attached roots is ambiguous
    // and the model picks unpredictably, so a secondary root has to be *named* —
    // which waits for the `root` parameter that arrives with the add-folder UI
    // (see plan.md, "Multiple roots").
    let Some(root) = roots.canonical.first() else {
        return Err(Refusal::RootMissing(roots.label(0)));
    };

    let rel_path = Path::new(rel);
    let mut rejects_relative = rel_path.is_absolute();
    for component in rel_path.components() {
        if matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        ) {
            rejects_relative = true;
        }
    }
    if rejects_relative {
        return Err(Refusal::NotRelative(rel.to_string()));
    }

    let candidate = root.join(rel_path);
    match dunce::canonicalize(&candidate) {
        Ok(canonical) => {
            if !canonical.starts_with(root) {
                return Err(Refusal::SymlinkEscape(rel.to_string()));
            }
            Ok(Resolved {
                root_index: 0,
                display: display_relative(root, &canonical),
                canonical,
            })
        }
        Err(_) => {
            // Doesn't exist. The nearest *existing* ancestor tells the two
            // failure modes apart: inside the root means the path is simply
            // wrong, outside means a symlink took it out of bounds.
            if let Some(ancestor) = nearest_existing_ancestor(&candidate) {
                let resolved = dunce::canonicalize(&ancestor).unwrap_or(ancestor);
                if !resolved.starts_with(root) {
                    return Err(Refusal::SymlinkEscape(rel.to_string()));
                }
            }
            Err(Refusal::NotFound(rel.to_string()))
        }
    }
}

fn nearest_existing_ancestor(path: &Path) -> Option<PathBuf> {
    let mut current = path.parent();
    while let Some(candidate) = current {
        if candidate.exists() {
            return Some(candidate.to_path_buf());
        }
        current = candidate.parent();
    }
    None
}

/// Root-relative, forward-slashed path (`src/lib/fs.rs`), or `.` for the root.
/// Prefixed with the root alias only when more than one root is attached.
fn display_relative(root: &Path, canonical: &Path) -> String {
    let rel = canonical
        .strip_prefix(root)
        .map(|p| {
            p.components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/")
        })
        .unwrap_or_default();
    if rel.is_empty() {
        ".".to_string()
    } else {
        rel
    }
}

fn display_in(roots: &RootSet, root_index: usize, absolute: &Path) -> String {
    let rel = display_relative(&roots.canonical[root_index], absolute);
    if roots.canonical.len() > 1 {
        format!("{}:{}", roots.alias(root_index), rel)
    } else {
        rel
    }
}

// -----------------------------------------------------------------------------
// read_file
// -----------------------------------------------------------------------------

/// Read a window of a text file, 1-based, with real line numbers.
///
/// Output lines are `{n}→{text}` — the model needs the numbers to cite a
/// location and to pick the next `offset`, and it matches `search_code`'s
/// `path:line:` shape rather than inventing a second convention.
pub fn read_file(
    roots: &[PathBuf],
    path: &str,
    offset: Option<usize>,
    limit: Option<usize>,
) -> String {
    let roots = RootSet::new(roots);
    let resolved = match resolve(&roots, path) {
        Ok(r) => r,
        Err(e) => return e.message(),
    };

    // Checked *before* opening: on Unix `File::open` happily opens a directory
    // and only fails later with EISDIR, which would come back as an `Error:`
    // infrastructure failure — and asking read_file for a directory is a normal
    // wrong guess, which must stay an observation.
    match std::fs::metadata(&resolved.canonical) {
        Ok(meta) if meta.is_dir() => {
            return format!(
                "{} is a directory, not a file — use list_dir to list it.",
                resolved.display
            )
        }
        Ok(_) => {}
        Err(e) => return io_error(&resolved.display, &e),
    }

    let mut reader = match File::open(&resolved.canonical) {
        Ok(f) => BufReader::new(f),
        Err(e) => return io_error(&resolved.display, &e),
    };

    // Peek at the buffered head without consuming it: NUL bytes mean binary,
    // which the line reader below would otherwise mangle or reject line by line.
    // (UTF-16 text trips this too, which is the honest answer for it.)
    if let Ok(peek) = reader.fill_buf() {
        if peek.contains(&0) {
            return format!(
                "Cannot read {} as text — it looks like a binary file (or is not UTF-8 text).",
                resolved.display
            );
        }
    }

    let start = offset.unwrap_or(1).max(1);
    let max_lines = limit.unwrap_or(READ_DEFAULT_LIMIT).clamp(1, READ_MAX_LIMIT);
    let deadline = Instant::now() + SEARCH_TIMEOUT;

    let mut body = String::new();
    let mut total_lines = 0usize;
    let mut emitted = 0usize;
    let mut cut_lines = 0usize;
    let mut budget_hit = false;
    let mut counting = true;

    loop {
        let line = match read_capped_line(&mut reader) {
            Ok(Some(line)) => line,
            Ok(None) => break,
            Err(e) => return io_error(&resolved.display, &e),
        };
        total_lines += 1;

        let (bytes, truncated) = line;

        if total_lines < start || emitted >= max_lines || budget_hit {
            // Past the requested window the only reason to keep reading is the
            // notice's line count — so a multi-GB log would otherwise be streamed
            // to its end for one sentence. The deadline ends that, and
            // `counting = false` is what downgrades the notice to "more than N
            // lines", which is the honest thing to say once we stopped.
            if Instant::now() > deadline {
                counting = false;
                break;
            }
            continue;
        }

        // Decoded lossily, and only for lines that are actually emitted: a stray
        // byte in a line *before* `offset`, or a multi-byte character cut in half
        // by the per-line cap, must not fail a read whose window is clean. Real
        // binary content was already refused by the NUL peek above.
        let text = String::from_utf8_lossy(&bytes);

        let line_out = if truncated {
            cut_lines += 1;
            format!(
                "{}→{} …[line truncated at {} chars]\n",
                total_lines, text, READ_MAX_LINE_CHARS
            )
        } else {
            format!("{}→{}\n", total_lines, text)
        };
        if body.len() + line_out.len() > READ_MAX_OUTPUT_CHARS {
            budget_hit = true;
            continue;
        }
        body.push_str(&line_out);
        emitted += 1;
    }

    if total_lines == 0 {
        return format!("{} is empty (0 lines).", resolved.display);
    }
    if start > total_lines {
        if !counting {
            return format!(
                "read_file stopped after {} lines (the read budget ran out) and never reached offset {} in {}. Search for the text instead of paging that far.",
                total_lines, start, resolved.display
            );
        }
        return format!(
            "{} has {} lines; offset {} is past the end. Start at offset 1.",
            resolved.display, total_lines, start
        );
    }

    let mut out = format!("File: {}\n", resolved.display);
    out.push_str(&body);

    let shown_to = start + emitted - 1;
    let size = if counting {
        format!("{} lines", total_lines)
    } else {
        format!("more than {} lines", total_lines)
    };
    if shown_to < total_lines || budget_hit {
        out.push_str(&format!(
            "[showing lines {}-{} of {}; continue with offset={}]\n",
            start,
            shown_to,
            size,
            shown_to + 1
        ));
    }
    if cut_lines > 0 {
        out.push_str(&format!(
            "[{} line(s) truncated at {} chars — read a narrower range if you need the rest]\n",
            cut_lines, READ_MAX_LINE_CHARS
        ));
    }
    if budget_hit {
        out.push_str(&format!(
            "[stopped at ~{} chars; the remainder continues at offset={}]\n",
            READ_MAX_OUTPUT_CHARS, shown_to
        ));
    }
    out
}

/// Read one line, buffering at most `READ_MAX_LINE_CHARS` bytes of it. When a
/// line is longer, the rest is *drained*, not buffered, so a single minified
/// line can't exhaust memory. Returns `None` at EOF.
fn read_capped_line<R: BufRead>(reader: &mut R) -> std::io::Result<Option<(Vec<u8>, bool)>> {
    let mut out: Vec<u8> = Vec::new();
    let mut truncated = false;
    let mut saw_any = false;

    loop {
        let available = match reader.fill_buf() {
            Ok(buf) => buf,
            Err(ref e) if e.kind() == ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        if available.is_empty() {
            return if saw_any {
                Ok(Some((out, truncated)))
            } else {
                Ok(None)
            };
        }
        saw_any = true;

        let newline = available.iter().position(|&b| b == b'\n');
        let upto = newline.map(|p| p + 1).unwrap_or(available.len());

        if !truncated {
            let remaining = READ_MAX_LINE_CHARS.saturating_sub(out.len());
            if upto <= remaining {
                out.extend_from_slice(&available[..upto]);
            } else {
                out.extend_from_slice(&available[..remaining]);
                truncated = true;
            }
        }
        reader.consume(upto);

        if newline.is_some() {
            if !truncated {
                // CRLF and LF both end up newline-free.
                while matches!(out.last(), Some(b'\n') | Some(b'\r')) {
                    out.pop();
                }
            }
            return Ok(Some((out, truncated)));
        }
    }
}

// -----------------------------------------------------------------------------
// search_code
// -----------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Content,
    Files,
    Count,
}

/// Format a byte count for the model, e.g. `84 KB`.
///
/// A size is appended to `search_code`'s `files` listing and to `list_dir`
/// because a model that can see *how big* a file is pages it with
/// `offset`/`limit`, and a model that cannot reads it whole — one unpaged read
/// of a large file was 56% of a run's whole byte budget.
///
/// The *number* is what does the work, and that was measured against
/// deepseek-v4.1-flash rather than assumed: the same listing read
/// `app/models/ticket.rb` unpaged with a bare filename, paged it at
/// `limit: 200` with `(84 KB)` beside it, and read it unpaged again with a bare
/// `[large]` marker. So don't "simplify" this to a boolean flag — a qualitative
/// hint is measurably worse than useless. The size comes from directory-entry
/// metadata, and only for files that survive the caps, so it costs a stat on at
/// most `SEARCH_MAX_TOTAL` entries rather than on the whole walk.
fn human_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = 1024 * 1024;
    if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{} KB", (bytes + KB / 2) / KB)
    } else {
        format!("{} B", bytes)
    }
}

/// Search inside the attached roots.
///
/// Literal by default (`regex: true` opts into regex syntax) because Luma's
/// models are weak: `user.name` should mean that string, but a regex engine
/// happily matches `userXname`. Smart-case, ripgrep's convention.
pub fn search_code(
    roots: &[PathBuf],
    query: &str,
    path: Option<&str>,
    glob: Option<&str>,
    output: Option<&str>,
    regex: bool,
    no_ignore: bool,
) -> String {
    let roots = RootSet::new(roots);
    if query.trim().is_empty() {
        return "No query given — search_code needs a string to look for.".to_string();
    }

    let mode = match output.unwrap_or("content") {
        "content" => Mode::Content,
        "files" => Mode::Files,
        "count" => Mode::Count,
        other => {
            return format!(
                "Unknown output mode {:?}. Use \"content\", \"files\", or \"count\".",
                other
            )
        }
    };

    let pattern = if regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    let matcher = match RegexMatcherBuilder::new()
        .case_smart(true)
        .build(&pattern)
    {
        Ok(m) => m,
        Err(e) => {
            return format!(
                "Invalid regular expression {:?}: {}. Search is literal by default — only set regex=true for real regex syntax.",
                query,
                first_line(&e.to_string())
            )
        }
    };

    // Narrow to a subdirectory/file when asked; otherwise search every root.
    let mut targets: Vec<(usize, PathBuf)> = Vec::new();
    match path {
        Some(p) => match resolve(&roots, p) {
            Ok(r) => targets.push((r.root_index, r.canonical)),
            Err(e) => return e.message(),
        },
        None => {
            for (index, root) in roots.canonical.iter().enumerate() {
                targets.push((index, root.clone()));
            }
        }
    }

    let mut searcher = SearcherBuilder::new()
        .line_number(true)
        .binary_detection(BinaryDetection::quit(b'\0'))
        .build();

    let deadline = Instant::now() + SEARCH_TIMEOUT;
    let mut timed_out = false;
    let mut hits: Vec<String> = Vec::new();
    let mut matched_files: Vec<(String, PathBuf)> = Vec::new();
    let mut counts: Vec<(String, usize)> = Vec::new();
    let mut capped_files = 0usize;

    'targets: for (root_index, target) in &targets {
        let mut builder = WalkBuilder::new(target);
        // Deterministic order matters twice over: results are contractually
        // sorted by path (`plan.md`), and when a cap truncates the list it is
        // also what decides *which* hits survive. Readdir order is neither.
        builder.sort_by_file_path(|a, b| a.cmp(b));
        builder.follow_links(false); // a symlink loop would otherwise never end
                                     // The attached folder's own `.gitignore` should apply whether or not it
                                     // is a git checkout (a vendored tree still means it), but ignore files
                                     // *above* the attached folder should not — those are someone else's
                                     // rules about someone else's tree.
        builder.require_git(false);
        builder.parents(false);
        // `.git` is a database, not source, and is the one path worth skipping
        // even when the caller asks for ignored files.
        builder.filter_entry(|entry| entry.file_name() != ".git");
        if no_ignore {
            builder
                .standard_filters(false)
                .hidden(false)
                .ignore(false)
                .git_ignore(false)
                .git_global(false)
                .git_exclude(false);
        }
        if let Some(pattern) = glob {
            match OverrideBuilder::new(target).add(pattern) {
                Ok(overrides) => match overrides.build() {
                    Ok(built) => {
                        builder.overrides(built);
                    }
                    Err(e) => {
                        return format!(
                            "Invalid glob {:?}: {}",
                            pattern,
                            first_line(&e.to_string())
                        )
                    }
                },
                Err(e) => {
                    return format!("Invalid glob {:?}: {}", pattern, first_line(&e.to_string()))
                }
            }
        }

        for entry in builder.build() {
            if Instant::now() > deadline {
                timed_out = true;
                break 'targets;
            }
            let Ok(entry) = entry else { continue };
            if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                continue;
            }
            let display = display_in(&roots, *root_index, entry.path());
            let mut per_file = 0usize;

            let result = searcher.search_path(
                &matcher,
                entry.path(),
                sinks::Lossy(|line_number, line| {
                    per_file += 1;
                    match mode {
                        Mode::Files => {
                            if matched_files.len() < SEARCH_MAX_TOTAL {
                                // Keep the path as well as the display form: the
                                // size is stat'd after the walk, for these files
                                // only, never for every file the walk opened.
                                matched_files.push((display.clone(), entry.path().to_path_buf()));
                            }
                        }
                        Mode::Content => {
                            if per_file <= SEARCH_MAX_PER_FILE && hits.len() < SEARCH_MAX_TOTAL {
                                hits.push(format!(
                                    "{}:{}:{}",
                                    display,
                                    line_number,
                                    trim_line_end(line)
                                ));
                            }
                        }
                        Mode::Count => {}
                    }
                    Ok(match mode {
                        // Deliberately one past the cap: that extra match is
                        // what proves the file had more, so the notice can say
                        // so without scanning the whole file.
                        Mode::Content => {
                            per_file <= SEARCH_MAX_PER_FILE && hits.len() < SEARCH_MAX_TOTAL
                        }
                        Mode::Files => false,
                        Mode::Count => true,
                    })
                }),
            );
            // A per-file read error (permissions, a file that vanished
            // mid-walk) skips that file rather than failing the search.
            if result.is_err() {
                continue;
            }

            if mode == Mode::Count && per_file > 0 {
                counts.push((display, per_file));
            }
            if mode == Mode::Content && per_file > SEARCH_MAX_PER_FILE {
                capped_files += 1;
            }

            // The cap is full: every remaining file would be opened only to have
            // its matches discarded, so stop the walk here rather than at the
            // deadline (which would also tack on a bogus "timed out" notice).
            if (mode == Mode::Content && hits.len() >= SEARCH_MAX_TOTAL)
                || (mode == Mode::Files && matched_files.len() >= SEARCH_MAX_TOTAL)
            {
                break 'targets;
            }
        }
    }

    // ── Results ──
    if mode == Mode::Count {
        let total: usize = counts.iter().map(|(_, n)| *n).sum();
        if total == 0 {
            return no_matches(query, regex, no_ignore, timed_out);
        }
        counts.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        let mut out = format!(
            "{} matches in {} file{}:\n",
            total,
            counts.len(),
            if counts.len() == 1 { "" } else { "s" }
        );
        for (path, n) in counts.iter().take(SEARCH_COUNT_LISTED) {
            out.push_str(&format!("{}: {}\n", path, n));
        }
        if counts.len() > SEARCH_COUNT_LISTED {
            out.push_str(&format!(
                "...and {} more file(s)\n",
                counts.len() - SEARCH_COUNT_LISTED
            ));
        }
        if timed_out {
            out.push_str(&timeout_notice());
        }
        return out;
    }

    if mode == Mode::Files {
        if matched_files.is_empty() {
            return no_matches(query, regex, no_ignore, timed_out);
        }
        let mut out = format!("{} file(s):\n", matched_files.len());
        for (path, abs) in &matched_files {
            out.push_str(path);
            if let Ok(m) = std::fs::metadata(abs) {
                out.push_str(&format!(" ({})", human_size(m.len())));
            }
            out.push('\n');
        }
        if matched_files.len() >= SEARCH_MAX_TOTAL {
            out.push_str(&format!(
                "[stopped at {} files — narrow with path or glob]\n",
                SEARCH_MAX_TOTAL
            ));
        }
        if timed_out {
            out.push_str(&timeout_notice());
        }
        return out;
    }

    if hits.is_empty() {
        return no_matches(query, regex, no_ignore, timed_out);
    }
    let mut out = String::new();
    for hit in &hits {
        out.push_str(hit);
        out.push('\n');
    }
    if capped_files > 0 {
        out.push_str(&format!(
            "[{} file(s) had more than {} matches; only the first {} of each are shown]\n",
            capped_files, SEARCH_MAX_PER_FILE, SEARCH_MAX_PER_FILE
        ));
    }
    if hits.len() >= SEARCH_MAX_TOTAL {
        out.push_str(&format!(
            "[stopped at {} matches — narrow with path or glob]\n",
            SEARCH_MAX_TOTAL
        ));
    }
    if timed_out {
        out.push_str(&timeout_notice());
    }
    out
}

fn no_matches(query: &str, regex: bool, no_ignore: bool, timed_out: bool) -> String {
    let mut out = format!("No matches for {:?}.", query);
    if !regex {
        out.push_str(" Search is literal by default; set regex=true for a pattern.");
    }
    if !no_ignore {
        out.push_str(
            " Ignored files (.gitignore) were skipped — set no_ignore=true to include them.",
        );
    }
    out.push('\n');
    if timed_out {
        out.push_str(&timeout_notice());
    }
    out
}

fn timeout_notice() -> String {
    format!(
        "[timed out after {}s — results are partial. Narrow `path` or `glob`, or use output=\"files\".]\n",
        SEARCH_TIMEOUT.as_secs()
    )
}

fn trim_line_end(line: &str) -> &str {
    line.trim_end_matches(['\n', '\r'])
}

fn first_line(s: &str) -> &str {
    s.lines().next().unwrap_or("invalid pattern")
}

// -----------------------------------------------------------------------------
// list_dir
// -----------------------------------------------------------------------------

/// List one directory level: directories first, then alphabetical.
///
/// Luma has no shell, so `ls` has to be a tool. Symlinks are marked `@` — they
/// are the one entry type whose contents may be refused by the guard.
pub fn list_dir(roots: &[PathBuf], path: Option<&str>) -> String {
    let roots = RootSet::new(roots);
    let rel = path.unwrap_or(".");
    let resolved = match resolve(&roots, rel) {
        Ok(r) => r,
        Err(e) => return e.message(),
    };

    let metadata = match std::fs::metadata(&resolved.canonical) {
        Ok(m) => m,
        Err(e) => return io_error(&resolved.display, &e),
    };
    if !metadata.is_dir() {
        return format!(
            "{} is a file, not a directory — use read_file to read it.",
            resolved.display
        );
    }

    let dir = match std::fs::read_dir(&resolved.canonical) {
        Ok(d) => d,
        Err(e) => return io_error(&resolved.display, &e),
    };

    let mut dirs: Vec<String> = Vec::new();
    // Files carry their size: a listing is the other place the model decides
    // whether to read a file whole or page it (see `human_size`).
    let mut files: Vec<(String, Option<u64>)> = Vec::new();
    let mut symlinks: Vec<String> = Vec::new();
    for entry in dir.into_iter().flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let size = entry.metadata().ok().map(|m| m.len());
        match entry.file_type() {
            Ok(t) if t.is_symlink() => symlinks.push(name),
            Ok(t) if t.is_dir() => dirs.push(name),
            Ok(_) => files.push((name, size)),
            Err(_) => files.push((name, size)),
        }
    }
    let sort = |v: &mut Vec<String>| v.sort_by_key(|n| n.to_lowercase());
    sort(&mut dirs);
    files.sort_by_key(|(name, _)| name.to_lowercase());
    sort(&mut symlinks);

    let total = dirs.len() + files.len() + symlinks.len();
    if total == 0 {
        return format!("{} is an empty directory (0 entries).", resolved.display);
    }

    let mut out = format!("Directory: {} ({} entries)\n", resolved.display, total);
    let mut shown = 0usize;
    let push = |out: &mut String, name: &str, suffix: &str, shown: &mut usize| {
        if *shown >= LIST_MAX_ENTRIES {
            return;
        }
        out.push_str(name);
        out.push_str(suffix);
        out.push('\n');
        *shown += 1;
    };
    for name in &dirs {
        push(&mut out, name, "/", &mut shown);
    }
    for name in &symlinks {
        push(&mut out, name, "@", &mut shown);
    }
    for (name, size) in &files {
        match size {
            Some(bytes) => push(
                &mut out,
                name,
                &format!(" ({})", human_size(*bytes)),
                &mut shown,
            ),
            None => push(&mut out, name, "", &mut shown),
        }
    }
    if total > shown {
        out.push_str(&format!("[{} more entries not shown]\n", total - shown));
    }
    out
}

// -----------------------------------------------------------------------------
// Attach-time root validation
// -----------------------------------------------------------------------------

/// Gate for attaching a folder. Returns the canonical path to store.
///
/// This is the security boundary: one click on `/` or `$HOME` would grant a
/// whole-machine (or whole-home) boundary and make the per-call guard theatre.
/// It also refuses Luma's own data directory and any ancestor of it, which
/// would otherwise expose `luma.db` and every stored API key.
pub fn validate_root(path: &str, app_data_dir: Option<&Path>) -> Result<String, String> {
    let given = Path::new(path);
    if !given.is_absolute() {
        return Err("Pick a folder with the file picker — the path must be absolute.".to_string());
    }
    let canonical = match dunce::canonicalize(given) {
        Ok(c) => c,
        Err(_) => return Err("That folder no longer exists.".to_string()),
    };
    if !canonical.is_dir() {
        return Err("That path is a file, not a folder.".to_string());
    }
    if let Some(reason) = refused_as_root(&canonical, app_data_dir) {
        return Err(reason.to_string());
    }
    Ok(canonical.to_string_lossy().into_owned())
}

/// `refused_as_root`, for a path that may not exist on this machine.
///
/// A root restored from a backup taken elsewhere legitimately points at a folder
/// that isn't here, and that has to be *kept* — the UI marks it missing — so this
/// check can't require the path to exist. Everything on the denylist exists by
/// definition, so a path that doesn't resolve is never one of them.
pub fn is_refused_root(path: &str, app_data_dir: Option<&Path>) -> bool {
    match dunce::canonicalize(path) {
        Ok(canonical) => refused_as_root(&canonical, app_data_dir).is_some(),
        Err(_) => false,
    }
}

/// Paths Luma never reads from, whichever route they arrive by — attaching a
/// folder, a backup restored from another machine, or a hand-edited row.
///
/// Refusing the filesystem root, `$HOME`, and `$HOME`'s parent covers every
/// ancestor of a real project path (`/`, `/Users`, `/Users/me` on macOS), and
/// the app-data rule covers Luma's own folder directly — the one that holds
/// `luma.db` and therefore every stored API key.
fn refused_as_root(canonical: &Path, app_data_dir: Option<&Path>) -> Option<&'static str> {
    if canonical.parent().is_none() {
        return Some("Refusing to attach the filesystem root.");
    }
    if let Some(home) = home_dir() {
        if canonical == home {
            return Some(
                "Refusing to attach your home folder — attach a project inside it instead.",
            );
        }
        if Some(canonical) == home.parent() {
            return Some(
                "Refusing to attach the folder that holds every user's home folder — attach a project inside it instead.",
            );
        }
    }
    if let Some(app_dir) = app_data_dir {
        if let Ok(app_dir) = dunce::canonicalize(app_dir) {
            if app_dir.starts_with(canonical) {
                return Some("Refusing to attach Luma's own data folder.");
            }
        }
    }
    None
}

fn home_dir() -> Option<PathBuf> {
    let raw = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    let path = PathBuf::from(raw);
    dunce::canonicalize(&path).ok().or(Some(path))
}

fn io_error(display: &str, e: &std::io::Error) -> String {
    format!("Error: could not read {} ({})", display, e)
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn temp_dir(label: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "luma_fs_test_{}_{}_{}",
            std::process::id(),
            label,
            n
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(dir: &Path, rel: &str, contents: &str) -> PathBuf {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(&path, contents).unwrap();
        path
    }

    fn roots(root: &Path) -> Vec<PathBuf> {
        vec![root.to_path_buf()]
    }

    /// Every expected-failure message must stay clear of the bare word that the
    /// frontend reads as a failed tool call.
    fn assert_observation(msg: &str) {
        assert!(
            !msg.starts_with("Error"),
            "message would be classified as a failed call: {msg}"
        );
    }

    // ── Guard ──

    #[test]
    fn absolute_paths_and_parent_dir_are_refused() {
        let root = temp_dir("rel");
        write(&root, "a.txt", "hello\n");

        for path in ["/etc/hosts", "../outside.txt", "src/../../etc/hosts", "."] {
            let msg = read_file(&roots(&root), path, None, None);
            if path == "." {
                // `.` is a legitimate relative path (the root itself), which is
                // a directory — not a traversal attempt, and not a failure.
                assert_observation(&msg);
                assert!(msg.contains("is a directory"), "{msg}");
                continue;
            }
            assert_observation(&msg);
            assert!(msg.contains("relative to the project root"), "{msg}");
        }
    }

    #[test]
    fn missing_file_is_an_observation_not_an_error() {
        let root = temp_dir("missing");
        let msg = read_file(&roots(&root), "nope/at/all.rs", None, None);
        assert_observation(&msg);
        assert!(msg.starts_with("Not found:"), "{msg}");
    }

    #[test]
    fn component_wise_prefix_check_refuses_a_sibling_with_the_same_prefix() {
        // `root-evil` is not inside `root`, even though the string "/…/root" is
        // a prefix of "/…/root-evil". This is the trap the guard must not fall
        // into, exercised through a symlink because `..` is refused outright.
        let base = temp_dir("prefix");
        let root = base.join("root");
        let evil = base.join("root-evil");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&evil).unwrap();
        write(&evil, "secret.txt", "SECRET\n");

        #[cfg(unix)]
        std::os::unix::fs::symlink(&evil, root.join("sneaky")).unwrap();

        #[cfg(unix)]
        {
            let msg = read_file(&roots(&root), "sneaky/secret.txt", None, None);
            assert_observation(&msg);
            assert!(msg.contains("symlink"), "{msg}");
            assert!(!msg.contains("SECRET"), "leaked content: {msg}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn symlink_outside_the_root_is_refused_and_names_the_symlink() {
        let base = temp_dir("symlink_out");
        let root = base.join("root");
        std::fs::create_dir_all(&root).unwrap();
        let outside = write(&base, "outside.txt", "top secret\n");
        std::os::unix::fs::symlink(&outside, root.join("link.txt")).unwrap();

        let msg = read_file(&roots(&root), "link.txt", None, None);
        assert_observation(&msg);
        assert!(msg.contains("symlink"), "{msg}");
        assert!(!msg.contains("top secret"), "leaked content: {msg}");
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_inside_the_root_are_readable() {
        let root = temp_dir("symlink_in");
        write(&root, "real/target.txt", "inside\n");
        std::os::unix::fs::symlink(root.join("real"), root.join("alias")).unwrap();

        let msg = read_file(&roots(&root), "alias/target.txt", None, None);
        assert!(msg.contains("inside"), "{msg}");
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_root_still_resolves_its_own_children() {
        let base = temp_dir("symlink_root");
        let real = base.join("real");
        std::fs::create_dir_all(&real).unwrap();
        write(&real, "a.txt", "found\n");
        let link = base.join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        // The root is handed over as the symlink; it must canonicalize before
        // the prefix check or its own children fail `starts_with`.
        let msg = read_file(&roots(&link), "a.txt", None, None);
        assert!(msg.contains("found"), "{msg}");
    }

    #[test]
    fn overlapping_roots_are_dropped_and_the_filesystem_root_is_never_one() {
        let root = temp_dir("nested");
        let child = root.join("child");
        std::fs::create_dir_all(&child).unwrap();
        write(&root, "top.txt", "top\n");
        write(&child, "deep.txt", "deep\n");

        let set = RootSet::new(&[root.clone(), child.clone()]);
        assert_eq!(set.canonical.len(), 1, "nested root was not dropped");
        assert_eq!(set.canonical[0], dunce::canonicalize(&root).unwrap());

        let set = RootSet::new(&[PathBuf::from("/"), root.clone()]);
        assert_eq!(set.canonical.len(), 1, "filesystem root was accepted");
        assert_eq!(set.canonical[0], dunce::canonicalize(&root).unwrap());
    }

    #[test]
    fn a_deleted_root_is_reported_as_missing_not_as_not_found() {
        let root = temp_dir("gone");
        let gone = root.join("sub");
        std::fs::create_dir_all(&gone).unwrap();
        let roots = roots(&gone);
        std::fs::remove_dir_all(&gone).unwrap();

        let msg = read_file(&roots, "a.txt", None, None);
        assert_observation(&msg);
        assert!(msg.contains("no longer there"), "{msg}");
        assert!(msg.contains("sub"), "should name the folder: {msg}");
    }

    // ── resolve ──

    /// Relative paths resolve against the **primary** root only — a flat
    /// namespace where a path could mean either of two attached roots is
    /// ambiguous, and the model picks unpredictably (`plan.md`, "Multiple
    /// roots"). `search_code` still spans every root.
    #[test]
    fn relative_paths_resolve_against_the_primary_root_only() {
        let primary = temp_dir("primary");
        let secondary = temp_dir("secondary");
        write(&primary, "a.txt", "primary\n");
        write(&secondary, "b.txt", "secondary\n");

        let both = vec![primary.clone(), secondary.clone()];
        let hits = search_code(&both, "secondary", None, None, Some("files"), false, false);
        assert!(
            hits.contains("b.txt"),
            "search must span both roots: {hits}"
        );

        let miss = read_file(&both, "b.txt", None, None);
        assert_observation(&miss);
        assert!(miss.contains("Not found"), "{miss}");

        let hit = read_file(&both, "a.txt", None, None);
        assert!(hit.contains("1→primary"), "{hit}");
    }

    // ── read_file ──

    #[test]
    fn read_file_numbers_lines_and_reports_the_next_offset() {
        let root = temp_dir("read");
        write(&root, "src/a.rs", "one\ntwo\nthree\n");

        let msg = read_file(&roots(&root), "src/a.rs", None, None);
        assert!(msg.contains("File: src/a.rs"), "{msg}");
        assert!(msg.contains("1→one\n2→two\n3→three\n"), "{msg}");

        let windowed = read_file(&roots(&root), "src/a.rs", Some(2), Some(1));
        assert!(windowed.contains("2→two"), "{windowed}");
        assert!(!windowed.contains("1→one"), "{windowed}");
        assert!(windowed.contains("continue with offset=3"), "{windowed}");
    }

    #[test]
    fn read_file_handles_empty_past_eof_and_crlf() {
        let root = temp_dir("edge");
        write(&root, "empty.txt", "");
        write(&root, "crlf.txt", "a\r\nb\r\n");

        let empty = read_file(&roots(&root), "empty.txt", None, None);
        assert!(empty.contains("empty (0 lines)"), "{empty}");

        let past = read_file(&roots(&root), "crlf.txt", Some(9), None);
        assert_observation(&past);
        assert!(past.contains("past the end"), "{past}");

        let crlf = read_file(&roots(&root), "crlf.txt", None, None);
        assert!(crlf.contains("1→a\n"), "{crlf}");
        assert!(!crlf.contains('\r'), "{crlf}");
    }

    #[test]
    fn read_file_refuses_a_directory_and_binary() {
        let root = temp_dir("dirbin");
        write(&root, "src/keep.rs", "ok\n");
        std::fs::write(root.join("blob.bin"), [0u8, 1, 2, 3, 0u8, 9]).unwrap();

        let dir = read_file(&roots(&root), "src", None, None);
        assert_observation(&dir);
        assert!(dir.contains("is a directory"), "{dir}");
        assert!(dir.contains("list_dir"), "{dir}");

        let binary = read_file(&roots(&root), "blob.bin", None, None);
        assert_observation(&binary);
        assert!(binary.contains("binary"), "{binary}");
    }

    #[test]
    fn read_file_truncates_a_very_long_line_without_buffering_it() {
        let root = temp_dir("longline");
        let long = "x".repeat(READ_MAX_LINE_CHARS * 3);
        write(&root, "min.js", &format!("short\n{}\nafter\n", long));

        let msg = read_file(&roots(&root), "min.js", None, None);
        assert!(msg.contains("1→short"), "{msg}");
        assert!(msg.contains("[line truncated at 2000 chars]"), "{msg}");
        assert!(
            msg.contains("3→after"),
            "line numbering must survive: {msg}"
        );
        assert!(
            msg.len() < READ_MAX_OUTPUT_CHARS + 2000,
            "output budget was blown: {}",
            msg.len()
        );
    }

    /// A legacy-encoded byte, or a multi-byte character cut in half by the
    /// per-line cap, used to fail the whole read as "not valid UTF-8" even when
    /// the requested window was clean. Both are the file's business, not the
    /// read's — only the NUL peek gets to refuse a file.
    #[test]
    fn read_file_survives_bad_bytes_outside_and_straddling_the_window() {
        let root = temp_dir("utf8");
        // Line 1 is Latin-1 (`é` as 0xE9), line 2 is clean ASCII.
        std::fs::write(root.join("legacy.txt"), b"caf\xE9\nplain\n").unwrap();
        let windowed = read_file(&roots(&root), "legacy.txt", Some(2), Some(1));
        assert!(
            windowed.contains("2→plain"),
            "a bad byte before the window must not fail it: {windowed}"
        );

        // 2000 bytes cuts a 3-byte character in half (1998 is the last boundary).
        let filler = "€".repeat(READ_MAX_LINE_CHARS);
        write(&root, "min.js", &format!("{}\nafter\n", filler));
        let cut = read_file(&roots(&root), "min.js", None, None);
        assert!(cut.contains("[line truncated at 2000 chars]"), "{cut}");
        assert!(
            cut.contains("2→after"),
            "a split character must not fail the read: {cut}"
        );
    }

    // ── search_code ──

    #[test]
    fn search_is_literal_by_default_and_regex_is_opt_in() {
        let root = temp_dir("literal");
        write(&root, "a.txt", "user.name\nuserXname\n");

        let literal = search_code(&roots(&root), "user.name", None, None, None, false, false);
        assert!(literal.contains("1:user.name"), "{literal}");
        assert!(!literal.contains("userXname"), "{literal}");

        let regex = search_code(&roots(&root), "user.name", None, None, None, true, false);
        assert!(regex.contains("userXname"), "{regex}");
    }

    #[test]
    fn search_respects_gitignore_unless_no_ignore_is_set() {
        let root = temp_dir("ignore");
        write(&root, ".gitignore", "ignored.txt\nbuild/\n");
        write(&root, "ignored.txt", "NEEDLE\n");
        write(&root, "build/out.js", "NEEDLE\n");
        write(&root, "kept.txt", "NEEDLE\n");

        let respected = search_code(
            &roots(&root),
            "NEEDLE",
            None,
            None,
            Some("files"),
            false,
            false,
        );
        assert!(respected.contains("kept.txt"), "{respected}");
        assert!(!respected.contains("ignored.txt"), "{respected}");
        assert!(!respected.contains("out.js"), "{respected}");

        let all = search_code(
            &roots(&root),
            "NEEDLE",
            None,
            None,
            Some("files"),
            false,
            true,
        );
        assert!(all.contains("ignored.txt"), "{all}");
        assert!(all.contains("out.js"), "{all}");
    }

    #[test]
    fn search_content_files_and_count_modes() {
        let root = temp_dir("modes");
        write(&root, "a.txt", "needle\nneedle\n");
        write(&root, "b.txt", "needle\n");

        let content = search_code(&roots(&root), "needle", None, None, None, false, false);
        assert!(content.contains("a.txt:1:needle"), "{content}");
        assert!(content.contains("a.txt:2:needle"), "{content}");
        assert!(content.contains("b.txt:1:needle"), "{content}");

        let files = search_code(
            &roots(&root),
            "needle",
            None,
            None,
            Some("files"),
            false,
            false,
        );
        assert!(files.contains("2 file(s)"), "{files}");
        assert!(files.contains("a.txt"), "{files}");

        let count = search_code(
            &roots(&root),
            "needle",
            None,
            None,
            Some("count"),
            false,
            false,
        );
        assert!(count.contains("3 matches in 2 files"), "{count}");
        assert!(count.contains("a.txt: 2"), "{count}");
    }

    #[test]
    fn search_caps_matches_per_file() {
        let root = temp_dir("cap");
        let many: String = "match\n".repeat(SEARCH_MAX_PER_FILE + 5);
        write(&root, "many.txt", &many);
        write(&root, "one.txt", "match\n");

        let msg = search_code(&roots(&root), "match", None, None, None, false, false);
        assert_eq!(
            msg.matches("many.txt:").count(),
            SEARCH_MAX_PER_FILE,
            "per-file cap not applied: {msg}"
        );
        assert!(msg.contains("more than 20 matches"), "{msg}");
        assert!(msg.contains("one.txt:1:match"), "{msg}");
    }

    #[test]
    fn human_size_formats_byte_counts() {
        assert_eq!(human_size(0), "0 B");
        assert_eq!(human_size(999), "999 B");
        assert_eq!(human_size(1024), "1 KB");
        assert_eq!(human_size(85_527), "84 KB");
        assert_eq!(human_size(1024 * 1024), "1.0 MB");
        assert_eq!(human_size(3 * 1024 * 1024 + 512 * 1024), "3.5 MB");
    }

    /// Both listings the model uses to pick a file carry its size. The size is
    /// what makes it page a large file instead of reading it whole, so a
    /// missing suffix is a behaviour change, not a cosmetic one.
    #[test]
    fn listings_report_file_sizes() {
        let root = temp_dir("sizes");
        write(&root, "a.txt", "needle\n");
        write(&root, "sub/b.txt", "needle\n");

        let files = search_code(
            &roots(&root),
            "needle",
            None,
            None,
            Some("files"),
            false,
            false,
        );
        assert!(files.contains("a.txt ("), "{files}");
        assert!(files.contains("sub/b.txt ("), "{files}");

        let listing = list_dir(&roots(&root), None);
        assert!(listing.contains("a.txt ("), "{listing}");
        // A directory keeps its `/` marker and carries no size.
        assert!(listing.contains("sub/"), "{listing}");
        assert!(!listing.contains("sub/ ("), "{listing}");
    }

    /// Sorted by path, so what survives a cap doesn't depend on readdir order.
    #[test]
    fn search_results_are_sorted_by_path() {
        let root = temp_dir("sorted");
        // Written out of order, so a raw directory walk wouldn't be sorted.
        for name in ["c.rs", "a.rs", "b.rs"] {
            write(&root, name, "needle\n");
        }

        let msg = search_code(
            &roots(&root),
            "needle",
            None,
            None,
            Some("content"),
            false,
            false,
        );
        assert_eq!(msg, "a.rs:1:needle\nb.rs:1:needle\nc.rs:1:needle\n");
    }

    #[test]
    fn search_accepts_a_brace_glob_of_the_shape_models_emit() {
        // gemma4 emitted `**/*.{ts,tsx,js,jsx}` unprompted, and brace
        // alternation goes through `ignore`'s OverrideBuilder, not ripgrep's
        // own parser — pin that it works rather than assuming it does.
        let root = temp_dir("brace_glob");
        write(&root, "src/a.rs", "needle\n");
        write(&root, "src/b.txt", "needle\n");
        write(&root, "docs/c.md", "needle\n");

        let msg = search_code(
            &roots(&root),
            "needle",
            None,
            Some("**/*.{txt,md}"),
            Some("files"),
            false,
            false,
        );
        assert!(msg.contains("src/b.txt"), "{msg}");
        assert!(msg.contains("docs/c.md"), "{msg}");
        assert!(!msg.contains("a.rs"), "{msg}");
    }

    #[test]
    fn search_narrows_with_path_and_glob_and_reports_no_matches() {
        let root = temp_dir("narrow");
        write(&root, "src/a.rs", "needle\n");
        write(&root, "src/a.js", "needle\n");
        write(&root, "docs/x.md", "needle\n");

        let by_path = search_code(
            &roots(&root),
            "needle",
            Some("src"),
            None,
            Some("files"),
            false,
            false,
        );
        assert!(
            by_path.contains("src/a.rs") && by_path.contains("src/a.js"),
            "{by_path}"
        );
        assert!(!by_path.contains("docs/x.md"), "{by_path}");

        let by_glob = search_code(
            &roots(&root),
            "needle",
            None,
            Some("*.rs"),
            Some("files"),
            false,
            false,
        );
        assert!(by_glob.contains("src/a.rs"), "{by_glob}");
        assert!(!by_glob.contains("a.js"), "{by_glob}");

        let none = search_code(
            &roots(&root),
            "nothing-here",
            None,
            None,
            None,
            false,
            false,
        );
        assert_observation(&none);
        assert!(none.contains("No matches"), "{none}");

        let bad_regex = search_code(&roots(&root), "a(", None, None, None, true, false);
        assert_observation(&bad_regex);
        assert!(
            bad_regex.contains("Invalid regular expression"),
            "{bad_regex}"
        );

        let bad_mode = search_code(
            &roots(&root),
            "needle",
            None,
            None,
            Some("nope"),
            false,
            false,
        );
        assert!(bad_mode.contains("Unknown output mode"), "{bad_mode}");

        let narrow_missing = search_code(
            &roots(&root),
            "needle",
            Some("nope/"),
            None,
            None,
            false,
            false,
        );
        assert_observation(&narrow_missing);
        assert!(narrow_missing.starts_with("Not found:"), "{narrow_missing}");
    }

    // ── list_dir ──

    #[test]
    fn list_dir_sorts_directories_first_then_files() {
        let root = temp_dir("list");
        write(&root, "z.txt", "z\n");
        write(&root, "a.txt", "a\n");
        write(&root, "src/keep.rs", "x\n");

        let msg = list_dir(&roots(&root), Some("."));
        assert!(msg.starts_with("Directory: . (3 entries)"), "{msg}");
        let lines: Vec<&str> = msg.lines().collect();
        assert_eq!(lines[1], "src/", "{msg}");
        // Files now carry a size suffix (see `human_size`); the ordering is what
        // this test is about, so it asserts on the name.
        assert!(lines[2].starts_with("a.txt ("), "{msg}");
        assert!(lines[3].starts_with("z.txt ("), "{msg}");

        let sub = list_dir(&roots(&root), Some("src"));
        assert!(sub.contains("Directory: src (1 entries)"), "{sub}");
        assert!(sub.contains("keep.rs"), "{sub}");

        let empty = temp_dir("list_empty");
        assert!(list_dir(&roots(&empty), None).contains("empty directory"));
    }

    #[test]
    fn list_dir_refuses_a_file() {
        let root = temp_dir("list_file");
        write(&root, "a.txt", "a\n");
        let msg = list_dir(&roots(&root), Some("a.txt"));
        assert_observation(&msg);
        assert!(msg.contains("not a directory"), "{msg}");
        assert!(msg.contains("read_file"), "{msg}");
    }

    // ── validate_root ──

    #[test]
    fn validate_root_refuses_files_missing_paths_and_luma_own_data() {
        let base = temp_dir("validate");
        let project = base.join("project");
        std::fs::create_dir_all(&project).unwrap();
        write(&base, "a.txt", "x\n");

        let ok = validate_root(project.to_str().unwrap(), None).unwrap();
        assert_eq!(ok, dunce::canonicalize(&project).unwrap().to_string_lossy());

        assert!(validate_root(base.join("a.txt").to_str().unwrap(), None).is_err());
        assert!(validate_root(base.join("nope").to_str().unwrap(), None).is_err());
        assert!(validate_root("relative/path", None).is_err());

        // The app data dir, and any ancestor of it, would expose luma.db.
        let app_data = project.join("appdata");
        std::fs::create_dir_all(&app_data).unwrap();
        assert!(validate_root(app_data.to_str().unwrap(), Some(&app_data)).is_err());
        assert!(validate_root(project.to_str().unwrap(), Some(&app_data)).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn validate_root_refuses_the_filesystem_root() {
        assert!(validate_root("/", None).is_err());
    }

    /// A restored backup's roots go straight into the DB, and the file tools
    /// read them back out — so the attach-time denylist is re-applied per call.
    /// A root that merely isn't on this machine is *kept*: the UI marks it
    /// missing, and losing the attachment would be worse than the risk.
    #[test]
    fn refused_roots_are_rejected_but_missing_ones_are_kept() {
        let app_data = temp_dir("appdata");
        let home = home_dir().expect("a home directory to test against");
        let parent = home.parent().expect("a parent of $HOME");

        assert!(is_refused_root(&home.to_string_lossy(), Some(&app_data)));
        assert!(is_refused_root(&parent.to_string_lossy(), Some(&app_data)));
        assert!(is_refused_root(
            &app_data.to_string_lossy(),
            Some(&app_data)
        ));
        assert!(is_refused_root("/", Some(&app_data)));

        assert!(!is_refused_root("/nowhere/at/all", Some(&app_data)));
        assert!(!is_refused_root(
            &temp_dir("fine").to_string_lossy(),
            Some(&app_data)
        ));
    }

    #[test]
    fn no_refusal_message_starts_with_the_word_error() {
        let root = temp_dir("invariant");
        write(&root, "a.txt", "x\n");
        let messages = vec![
            read_file(&roots(&root), "../a.txt", None, None),
            read_file(&roots(&root), "/etc/hosts", None, None),
            read_file(&roots(&root), "gone.txt", None, None),
            read_file(&roots(&root), "a.txt", Some(50), None),
            read_file(&roots(&root), ".", None, None),
            list_dir(&roots(&root), Some("a.txt")),
            search_code(&roots(&root), "nothing", None, None, None, false, false),
            search_code(&roots(&root), "a(", None, None, None, true, false),
        ];
        for msg in messages {
            assert_observation(&msg);
        }
    }
}
