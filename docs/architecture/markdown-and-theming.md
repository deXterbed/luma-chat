# Markdown, theming and theme persistence

All markdown element styling lives in the `components` prop of `MarkdownBody.jsx`, not CSS.

`src/theme.js` holds the `dark`/`light` palettes (`getTheme(name)`) and sets `data-theme` on `<html>`; `src/index.css` mirrors the same tokens as CSS custom properties. CSS Modules for scoped styles — no Tailwind.

`index.css`'s global `*{margin:0;padding:0}` reset strips list indentation, so `ul`/`ol`/`li` need explicit padding overrides in `MarkdownBody.jsx`.

**All markdown element styling lives in the `components` prop of `<ReactMarkdown>` in `MarkdownBody.jsx` (inline styles), not CSS** — the `.markdown-body …` block in `index.css` is dead (the component uses the hashed `styles.markdownBody` class instead). `table` uses `table-layout: fixed` + `width: 100%`; `th`/`td` use `word-break: normal` / `overflow-wrap: break-word` (not `word-break: break-word`, which splits letter-by-letter) so long cell content wraps within its column instead of overflowing into the next one. To style a new tag, add it to the `components` prop, not the dead CSS rules.
Theme persistence lives in SQLite via `useSettingsStore`. An inline `<script>` in `index.html`'s `<head>` sets `data-theme` synchronously before React mounts (from legacy `localStorage`, else `prefers-color-scheme`) to avoid a flash; `useSettingsStore.hydrate()` then re-applies the authoritative SQLite value.
