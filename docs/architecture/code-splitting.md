# Code splitting

What may and may not be lazy-loaded.

`SidePanel` and `SettingsPage` are `React.lazy()`-wrapped at module scope (so the resolved module is cached and later mounts skip the Suspense flash). Both only ever mount from an explicit user action, never during boot.

Don't lazy-load something that can appear in the *initial* render (e.g. hydrated/restored state) — `ToolActivity` was tried and reverted because historical tool-call bubbles from a restored session mount immediately at launch, causing a visible flash. Also don't lazy-load components needed on every hot-path render (`MarkdownBody`, `ReactMarkdown`, `remark-gfm`) or `App` itself from `main.jsx` — no caching win for a local Tauri bundle, just an extra async hop.
