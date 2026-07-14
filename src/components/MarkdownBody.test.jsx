import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { open } from "@tauri-apps/plugin-shell";
import MarkdownBody, { buildMarkdownComponents } from "./MarkdownBody";
import { getTheme } from "../theme";

// The browser normalizes hex colors to rgb() in element.style. Convert the
// expected theme tokens the same way before comparing.
function toRgb(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

// Render markdown and return the container.
function renderMd(markdown, theme = getTheme("dark")) {
  const { container } = render(
    <MarkdownBody content={markdown} theme={theme} />,
  );
  return container;
}

describe("MarkdownBody", () => {
  beforeEach(() => {
    open.mockReset();
  });

  it("renders a top-level heading with the fixed 18px size", () => {
    const c = renderMd("# Title");
    const h1 = c.querySelector("h1");
    expect(h1).not.toBeNull();
    expect(h1.style.fontSize).toBe("18px");
    expect(h1.textContent).toBe("Title");
  });

  it("renders h2 at 15px and h3 at 14px", () => {
    const c = renderMd("## Sub\n\n### Subsub");
    expect(c.querySelector("h2").style.fontSize).toBe("15px");
    expect(c.querySelector("h3").style.fontSize).toBe("14px");
  });

  it("renders paragraphs with the 0 0 8px margin and 1.65 line-height", () => {
    const c = renderMd("Hello world");
    const p = c.querySelector("p");
    expect(p).not.toBeNull();
    expect(p.style.margin).toBe("0px 0px 8px 0px");
    expect(p.style.lineHeight).toBe("1.65");
  });

  it("renders inline code with the theme code background", () => {
    const theme = getTheme("dark");
    const c = renderMd("Use the `foo` function.");
    const code = c.querySelector("p code");
    expect(code).not.toBeNull();
    expect(code.style.background).toBe(toRgb(theme.codeBg));
    expect(code.style.color).toBe(toRgb(theme.codeText));
    expect(code.style.border).toContain(toRgb(theme.codeBorder));
    // inline code should NOT be wrapped in a <pre>
    expect(c.querySelector("pre")).toBeNull();
  });

  it("renders fenced code blocks inside a styled <pre> with the theme pre background", () => {
    const theme = getTheme("dark");
    const c = renderMd("```\nline one\nline two\n```");
    // react-markdown wraps block code in a default <pre>; our `code` override
    // returns its own <pre><code>. Anchor on the inner <code> and walk up to
    // the styled pre (the existing nested-pre structure, preserved verbatim).
    const code = c.querySelector("pre code");
    expect(code).not.toBeNull();
    expect(code.style.color).toBe(toRgb(theme.preText));
    expect(code.style.fontFamily).toContain("JetBrains Mono");
    const pre = code.parentElement;
    expect(pre.tagName).toBe("PRE");
    expect(pre.style.background).toBe(toRgb(theme.preBg));
    expect(pre.style.border).toContain(toRgb(theme.preBorder));
  });

  it("restores list indentation that the global reset strips", () => {
    const c = renderMd("- a\n- b\n\n1. one\n2. two");
    const ul = c.querySelector("ul");
    const ol = c.querySelector("ol");
    expect(ul.style.paddingLeft).toBe("16px");
    expect(ol.style.paddingLeft).toBe("28px");
    // list items get per-item bottom margin
    expect(c.querySelector("li").style.marginBottom).toBe("4px");
  });

  it("renders tables with fixed layout and theme-styled headers/cells", () => {
    const theme = getTheme("dark");
    const c = renderMd("| A | B |\n| --- | --- |\n| 1 | 2 |");
    const table = c.querySelector("table");
    expect(table.style.tableLayout).toBe("fixed");
    expect(table.style.width).toBe("100%");
    const th = c.querySelector("th");
    expect(th.style.background).toBe(toRgb(theme.mdThBg));
    expect(th.style.color).toBe(toRgb(theme.mdThText));
    const td = c.querySelector("td");
    expect(td.style.wordBreak).toBe("normal");
    expect(td.style.overflowWrap).toBe("normal");
    expect(td.style.border).toContain(toRgb(theme.mdTdBorder));
  });

  it("opens links via the Tauri shell `open` on click (CORS-safe)", () => {
    const c = renderMd("[site](https://example.com)");
    const link = c.querySelector("a");
    expect(link.getAttribute("href")).toBe("https://example.com");
    // Links carry a `title` showing the full URL on hover.
    expect(link.getAttribute("title")).toBe("https://example.com");
    fireEvent.click(link);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("https://example.com");
  });

  it("does not call open when clicking a link with no href", () => {
    // A link without href won't render as <a href> from markdown, but guard
    // the onClick branch by simulating a bare anchor click through React.
    const comps = buildMarkdownComponents(getTheme("dark"));
    const fakeEvent = { preventDefault: vi.fn() };
    comps.a({ href: undefined, children: "x" }).props.onClick(fakeEvent);
    expect(fakeEvent.preventDefault).toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("applies light-theme tokens when given the light theme", () => {
    const light = getTheme("light");
    const c = renderMd("`code`", light);
    const code = c.querySelector("p code");
    expect(code.style.background).toBe(toRgb(light.codeBg));
    expect(code.style.color).toBe(toRgb(light.codeText));
  });

  it("renders math via remark-math/rehype-katex without throwing", () => {
    const c = renderMd("Inline $$E=mc^2$$ and block:\n\n$$E=mc^2$$");
    // KaTeX renders into .katex elements; just assert no crash + content present
    expect(c.textContent).toContain("E=mc^2");
  });

  it("does not treat currency dollar signs as math delimiters", () => {
    const c = renderMd("**$40 per 100GB** ($0.40/GB)");
    expect(c.textContent).toContain("$40 per 100GB");
    expect(c.textContent).toContain("$0.40/GB");
  });
});

describe("buildMarkdownComponents", () => {
  it("returns an object keyed by the styled markdown tags", () => {
    const comps = buildMarkdownComponents(getTheme("dark"));
    for (const tag of [
      "code",
      "h1",
      "h2",
      "h3",
      "p",
      "ul",
      "ol",
      "li",
      "a",
      "table",
      "th",
      "td",
    ]) {
      expect(typeof comps[tag]).toBe("function");
    }
  });
});
