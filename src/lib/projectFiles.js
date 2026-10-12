// The file index behind the composer's `@`-mention autocomplete.
//
// Codebase mode only. `list_project_files` walks the attached roots in Rust
// (gitignore respected, hidden files skipped) and returns display paths; the
// filtering happens here, in the renderer.

import { db } from "./db";

/** Stable cache key for a root set — a string, so it can be an effect dep. */
export function projectFilesKey(roots) {
  return (roots || []).join("|");
}

// One shared value for "no index". An empty index is the same value every
// time, so `setFiles` with it is a no-op and doesn't re-render — a chat with no
// files, or a folder whose walk returns nothing, costs no render at all.
export const NO_FILES = [];

// One walk per root set, for the session. Keyed by the roots so attaching a
// folder re-walks and detaching drops it; a keystroke never re-walks a repo.
// Files added on disk mid-session won't appear until the folder is re-attached
// or the app restarts — the index is a convenience, and typing the path still
// works (that is what `read_file` resolves).
const cache = new Map();

export function loadProjectFiles(roots) {
  if (!Array.isArray(roots) || roots.length === 0) return Promise.resolve(NO_FILES);
  const key = projectFilesKey(roots);
  if (!cache.has(key)) {
    const promise = db.listProjectFiles(roots).then((files) =>
      Array.isArray(files) && files.length > 0 ? files : NO_FILES,
    );
    cache.set(key, promise);
  }
  return cache.get(key);
}

// Subsequence match: q's chars in order anywhere in s, not necessarily
// adjacent. Returns the first and last matched index (so callers can rank by
// how tight the match is), or null. Greedy left-to-right, so `span` is a
// good-enough compactness proxy rather than the provably tightest window.
function fuzzySpan(s, q) {
  let first = -1;
  let last = -1;
  let from = 0;
  for (const ch of q) {
    const at = s.indexOf(ch, from);
    if (at === -1) return null;
    if (first === -1) first = at;
    last = at;
    from = at + 1;
  }
  return { first, span: last - first + 1 };
}

/**
 * Rank the index against what has been typed after the `@`.
 *
 * Two tiers: a contiguous substring hit always outranks a scattered one, so
 * the fuzzy fallback only ever *adds* results below today's ordering. Within a
 * tier, a basename that starts with the query beats a mid-path match, an
 * earlier match beats a later one, a tighter match beats a looser one, and
 * shorter paths win ties — the usual fuzzy-finder ordering, without a library.
 */
export function filterFiles(files, query, limit = 8) {
  if (!Array.isArray(files) || files.length === 0) return [];
  const q = (query || "").trim().toLowerCase();
  if (!q) return files.slice(0, limit);

  const scored = [];
  for (const file of files) {
    const lower = file.toLowerCase();
    const base = lower.slice(lower.lastIndexOf("/") + 1);
    const at = lower.indexOf(q);
    if (at !== -1) {
      scored.push({
        file,
        tier: 0,
        base: base.startsWith(q) ? 0 : 1,
        first: at,
        span: q.length,
        len: file.length,
      });
      continue;
    }
    const fuzzy = fuzzySpan(lower, q);
    if (fuzzy) {
      scored.push({
        file,
        tier: 1,
        base: 1,
        first: fuzzy.first,
        span: fuzzy.span,
        len: file.length,
      });
    }
  }
  scored.sort(
    (a, b) =>
      a.tier - b.tier ||
      a.base - b.base ||
      a.first - b.first ||
      a.span - b.span ||
      a.len - b.len ||
      (a.file < b.file ? -1 : 1),
  );
  return scored.slice(0, limit).map((s) => s.file);
}
