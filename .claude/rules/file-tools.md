---
paths: ["tauri/src/tools/fs.rs", "src/lib/fileMentions.js", "src/lib/projectFiles.js"]
---

# File-tool rules

Detail: `docs/architecture/codebase-mode.md`. That file records the measurements behind the caps; the
numbers are load-bearing, so don't tune them without reading it first.

- **The root set is the security boundary.** Relative paths only, resolved against one named root; canonicalize *both* root and target and check component-wise `Path::starts_with`. A secondary root is never guessed at.
- **Expected path failures are observations, not `Error:` strings** (not found, symlink escape, binary, past EOF, timeout, directory).
- **Caps apply before loading**, never `read_to_string` then truncate.
- **Listings carry file sizes on purpose.** A model that can see a file is large pages it; one that cannot reads it whole. Don't simplify the size to a boolean or a `[large]` marker.
- **Decode lines lossily.** A stray byte or a multi-byte character cut by the per-line cap must not fail a read whose window is fine; the NUL peek is the only thing that refuses a file.
- **A `Not found` names the folder that does have the file** (`... does exist under <alias> — pass that as root`). It turns a path-format hunt into a one-round correction.
- **`search_code`'s description teaches regex as an outline.** That sentence is what stops a full-file read for a comprehension question; don't drop it as prose.
- **The `@` index walks exactly as `search_code` does** (gitignore respected, hidden files skipped), so the picker offers what a search would find. A mention read is bounded twice: `MENTION_READ_LIMIT` per file and `CODEBASE_MAX_MENTION_BYTES` for all mentions.
