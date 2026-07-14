// CommonMark treats a backslash before punctuation as an escape sequence, so
// `\(`, `\)`, `\[`, `\]` lose their backslash by the time markdown finishes
// parsing — math written with those (the OpenAI/ChatGPT convention many
// models default to) never survives to be recognized as math. `$` and `$$`
// aren't CommonMark escape characters, so they pass through untouched and
// `remark-math` can reliably find them. This rewrites the backslash forms to
// dollar-sign form before markdown ever sees them, skipping fenced code
// blocks so literal `\(`/`\[` in code (e.g. regex, shell) isn't touched.
const FENCE_REGEX = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;

function convertSegment(text) {
  return text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, expr) => `$$${expr}$$`)
    .replace(/\\\(([^\n]+?)\\\)/g, (_, expr) => `$$${expr}$$`);
}

export function normalizeMathDelimiters(content) {
  return content
    .split(FENCE_REGEX)
    .map((segment, i) => (i % 2 === 1 ? segment : convertSegment(segment)))
    .join("");
}
