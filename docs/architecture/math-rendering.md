# Math rendering

`remark-math` + Temml. `normalizeMathDelimiters()` must keep emitting `$$...$$`.

Math uses `remark-math` + `MathSpan` (`src/components/MathSpan.jsx`) + `temml` (not KaTeX/MathJax). `remark-math` only recognizes `$...$`/`$$...$$`, not the `\( \)`/`\[ \]` delimiters most models emit (CommonMark strips the backslash before any renderer sees it). `src/lib/mathDelimiters.js`'s `normalizeMathDelimiters()` rewrites both bracket forms to `$$...$$` before the string reaches `remark`, skipping fenced *and inline* code.

`MarkdownBody.jsx` passes `{ singleDollarTextMath: false }` to `remarkMath` so ordinary currency text (`$40`, `$0.40`) isn't misread as inline math. The flip side is that a model writing `$2^n$` gets no math at all, so `normalizeMathDelimiters()` also upgrades an inline `$...$` span to `$$...$$` — but only when it unambiguously looks like math, using pandoc's inline-math rules (opening `$` not followed by whitespace, closing `$` not preceded by whitespace nor followed by a digit). Currency, `$$...$$`, and escaped `\$` are left untouched. `normalizeMathDelimiters()` must keep emitting `$$...$$` (never single `$`) to stay consistent with `singleDollarTextMath: false`.

`temml/dist/temml.mjs` has only a default export — import as `const { default: temml } = await import(...)`. `MathSpan` calls `temml.renderToString()` directly (its bundled `renderMathInElement` depends on a `window.temml` global it doesn't set itself, so avoid it).

`src/App.jsx` preloads the Temml chunk via `requestIdleCallback` (falls back to `setTimeout` for older WKWebView) after mount, so the first math message doesn't pay the ~200KB chunk cost.
