---
paths: ["src/components/MarkdownBody.jsx", "src/components/MathSpan.jsx", "src/lib/mathDelimiters.js", "src/index.css", "src/theme.js"]
---

# Markdown, math and theming rules

Detail: `docs/architecture/markdown-and-theming.md`, `math-rendering.md`.

- **All markdown element styling lives in the `components` prop of `<ReactMarkdown>` in `MarkdownBody.jsx`** (inline styles). The `.markdown-body …` block in `index.css` is dead; to style a new tag, add it to `components`, not CSS.
- **Memoize the `components` object with `useMemo(..., [theme])`** — the `code` override uses hooks, so a fresh object each render is a new component type.
- **`normalizeMathDelimiters()` must keep emitting `$$...$$`, never single `$`**, to stay consistent with `singleDollarTextMath: false`. Currency, `$$...$$` and escaped `\$` are left untouched.
- **`temml/dist/temml.mjs` has only a default export**, and `renderMathInElement` depends on a global it doesn't set — call `temml.renderToString()` directly.
- **`index.css`'s global reset strips list indentation**, so `ul`/`ol`/`li` need explicit padding overrides.
- **`table` needs `table-layout: fixed` + `width: 100%`,** and cells `word-break: normal` / `overflow-wrap: break-word` — not `word-break: break-word`, which splits letter-by-letter.
- Theme persistence is SQLite via `useSettingsStore`; an inline `<script>` in `<head>` sets `data-theme` before React mounts to avoid a flash. Don't move that into React.
