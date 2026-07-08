import { useEffect, useState } from "react";
import "temml/dist/Temml-Local.css";

// Renders one math node (from remark-math's `language-math`/`math-inline`/
// `math-display` code element) via Temml — LaTeX -> native MathML, no
// bundled font files, and far smaller than a full TeX engine like
// MathJax/KaTeX. Temml is dynamically imported only once math is actually
// present in a message.
export default function MathSpan({ tex, display }) {
  const [html, setHtml] = useState(null);

  useEffect(() => {
    let cancelled = false;
    import("temml/dist/temml.mjs").then(({ default: temml }) => {
      if (cancelled) return;
      try {
        setHtml(temml.renderToString(tex, { displayMode: display }));
      } catch {
        setHtml(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [tex, display]);

  const Tag = display ? "div" : "span";
  if (!html) return <Tag>{tex}</Tag>;
  return <Tag dangerouslySetInnerHTML={{ __html: html }} />;
}
