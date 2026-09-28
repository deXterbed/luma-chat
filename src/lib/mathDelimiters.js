// CommonMark treats a backslash before punctuation as an escape sequence, so
// `\(`, `\)`, `\[`, `\]` lose their backslash by the time markdown finishes
// parsing — math written with those (the OpenAI/ChatGPT convention many
// models default to) never survives to be recognized as math. `$` and `$$`
// aren't CommonMark escape characters, so they pass through untouched and
// `remark-math` can reliably find them. This rewrites the backslash forms to
// dollar-sign form before markdown ever sees them, skipping code (fenced and
// inline) so literal `\(`/`\[`/`$` in code (e.g. regex, shell) isn't touched.
//
// The same pass upgrades *inline* `$...$` math to `$$...$$`. `remark-math` is
// configured with `singleDollarTextMath: false` because chat text is full of
// literal currency (`$40 per 100GB ($0.40/GB)`), which it would otherwise pair
// up and mangle — but that also means a model writing `$2^n$` gets no math at
// all, just the literal dollars. So a single-`$` span is only rewritten when it
// unambiguously looks like math, using pandoc's inline-math rules: the opening
// `$` isn't followed by whitespace, the closing `$` isn't preceded by
// whitespace, and it isn't followed by a digit. Everything else — currency,
// `$$...$$`, escaped `\$` — is left for markdown to handle as plain text.
const CODE_SPAN_REGEX = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;

function isSpace(ch) {
  return ch !== undefined && /\s/.test(ch);
}

// Given the index of an opening single `$`, return the index of the closing
// one, or -1 if this `$` doesn't open inline math.
function findInlineMathClose(text, open) {
  if (isSpace(text[open + 1])) return -1;
  for (let j = open + 1; j < text.length; j++) {
    const ch = text[j];
    if (ch === "\n") return -1;
    if (ch !== "$") continue;
    // `$$` is display math (or a stray delimiter) — not ours to touch.
    if (text[j + 1] === "$") return -1;
    if (isSpace(text[j - 1])) return -1;
    if (/[0-9]/.test(text[j + 1] || "")) return -1;
    return j;
  }
  return -1;
}

function rewriteInlineMath(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch !== "$" || text[i - 1] === "\\") {
      out += ch;
      i++;
      continue;
    }
    // Copy a run of `$$...` (display math or stray delimiters) verbatim.
    if (text[i + 1] === "$") {
      let n = i;
      while (text[n] === "$") n++;
      out += text.slice(i, n);
      i = n;
      continue;
    }
    const close = findInlineMathClose(text, i);
    if (close === -1) {
      out += "$";
      i++;
      continue;
    }
    out += "$$" + text.slice(i + 1, close) + "$$";
    i = close + 1;
  }
  return out;
}

function convertSegment(text) {
  const tex = text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, expr) => `$$${expr}$$`)
    .replace(/\\\(([^\n]+?)\\\)/g, (_, expr) => `$$${expr}$$`);
  return rewriteInlineMath(tex);
}

export function normalizeMathDelimiters(content) {
  return content
    .split(CODE_SPAN_REGEX)
    .map((segment, i) => (i % 2 === 1 ? segment : convertSegment(segment)))
    .join("");
}
