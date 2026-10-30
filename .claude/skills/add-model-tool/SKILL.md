---
name: add-model-tool
description: Add a new tool the model can call. Use when adding or changing a tool schema, an executeTool case, or a read-only file tool.
---

Schema goes in `TOOLS` (`src/lib/tools.js`), dispatch in `executeTool`. Web tools must run as Tauri
commands (CORS); local tools run in the renderer. Read-only file tools belong in
`tauri/src/tools/fs.rs`.

- **Return every expected failure as an observation, never an `Error`-prefixed string.** `runToolCalls`
  classifies on the bare word `Error`, so a normal message that starts with it sends the session
  straight to its wrap-up round. `Error: QUOTA:` is the only deliberate exception.
- **Coerce stringly-typed args** (`"limit": "50"`) before invoking. A type mismatch fails the whole
  invoke and counts as a failed tool round.
- **Keep the description teaching, not just specifying.** The `search_code` description carries a
  sentence about anchored definition patterns, and that sentence is what stops a full-file read. New
  tools with a cheap/expensive path should say which to reach for.
- Update the agent log's verdict expectations if the tool can fail in a new way, and add a test
  alongside the existing `src/lib/tools.test.js` cases.
