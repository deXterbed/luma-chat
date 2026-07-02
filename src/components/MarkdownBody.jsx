// Markdown rendering concern for chat message bubbles.
//
// Owns the `<ReactMarkdown>` instance, its plugins (GFM, math, KaTeX), and the
// per-tag `components` overrides that style each markdown element with theme
// tokens. Extracted from `MessageBubble.jsx` so element styling is a localized,
// open-for-extension concern instead of ~150 inline lines inside the bubble.
//
// Per CLAUDE.md: all markdown element styling lives here (inline styles on the
// `components` overrides), NOT in `index.css` — the global `.markdown-body …`
// block there is dead because the component applies a hashed CSS-module class.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { open } from "@tauri-apps/plugin-shell";

const MONO = "'JetBrains Mono', monospace";

/**
 * Build the ReactMarkdown `components` overrides for a given theme.
 *
 * Each entry styles one markdown tag with inline styles drawn from `t` (the
 * theme token object from `src/theme.js`). Kept as a pure function (rather
 * than inlined in the component) so it can be unit-tested in isolation and so
 * adding a new tag override is a localized edit here.
 *
 * @param {object} t - theme tokens (must include the `code*` / `pre*` / `md*` keys)
 * @returns {object} ReactMarkdown `components` prop
 */
export function buildMarkdownComponents(t) {
  return {
    code({ className, children, ...props }) {
      const isBlock = String(children).includes("\n") || !!className;
      return isBlock ? (
        <pre
          style={{
            background: t.preBg,
            border: "1px solid " + t.preBorder,
            borderRadius: "6px",
            padding: "12px",
            overflowX: "auto",
            margin: "8px 0",
            width: "fit-content",
            maxWidth: "100%",
          }}
        >
          <code
            style={{
              fontSize: "12px",
              color: t.preText,
              fontFamily: MONO,
            }}
            className={className}
            {...props}
          >
            {children}
          </code>
        </pre>
      ) : (
        <code
          style={{
            background: t.codeBg,
            border: "1px solid " + t.codeBorder,
            borderRadius: "3px",
            padding: "1px 5px",
            fontSize: "12px",
            color: t.codeText,
            fontFamily: MONO,
            overflowWrap: "break-word",
            boxDecorationBreak: "clone",
            WebkitBoxDecorationBreak: "clone",
          }}
          {...props}
        >
          {children}
        </code>
      );
    },
    h1({ children }) {
      return (
        <h1 style={{ fontSize: "18px", margin: "12px 0 6px" }}>{children}</h1>
      );
    },
    h2({ children }) {
      return (
        <h2 style={{ fontSize: "15px", margin: "12px 0 6px" }}>{children}</h2>
      );
    },
    h3({ children }) {
      return (
        <h3 style={{ fontSize: "14px", margin: "10px 0 4px" }}>{children}</h3>
      );
    },
    p({ children }) {
      return <p style={{ margin: "0 0 8px", lineHeight: 1.65 }}>{children}</p>;
    },
    ul({ children }) {
      return (
        <ul style={{ paddingLeft: "16px", margin: "6px 0" }}>{children}</ul>
      );
    },
    ol({ children }) {
      return (
        <ol style={{ paddingLeft: "28px", margin: "6px 0" }}>{children}</ol>
      );
    },
    li({ children }) {
      return <li style={{ marginBottom: "4px" }}>{children}</li>;
    },
    a({ href, children }) {
      return (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            if (href) open(href);
          }}
        >
          {children}
        </a>
      );
    },
    table({ children }) {
      return (
        <table
          style={{
            borderCollapse: "collapse",
            width: "100%",
            tableLayout: "fixed",
            margin: "8px 0",
          }}
        >
          {children}
        </table>
      );
    },
    th({ children }) {
      return (
        <th
          style={{
            border: "1px solid " + t.mdTdBorder,
            background: t.mdThBg,
            color: t.mdThText,
            padding: "6px 10px",
            textAlign: "left",
            wordBreak: "normal",
            overflowWrap: "normal",
          }}
        >
          {children}
        </th>
      );
    },
    td({ children }) {
      return (
        <td
          style={{
            border: "1px solid " + t.mdTdBorder,
            padding: "6px 10px",
            wordBreak: "normal",
            overflowWrap: "normal",
          }}
        >
          {children}
        </td>
      );
    },
  };
}

/**
 * Render markdown `content` with GFM + math support, styled via `theme`.
 *
 * @param {object} props
 * @param {string} props.content  - markdown source
 * @param {object} props.theme    - theme tokens (from `getTheme(name)`)
 */
export default function MarkdownBody({ content, theme }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={buildMarkdownComponents(theme)}
    >
      {content}
    </ReactMarkdown>
  );
}
