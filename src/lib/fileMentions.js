// Parsing and insertion for the composer's `@`-mention file references.
//
// Three jobs, all pure so they can be unit-tested against a plain string:
//
//   - `activeMention`  — the token the caret is inside, which drives the picker
//   - `parseMentions`  — the mentions in a finished message, which drive send-time
//                        resolution in `useStreamingChat`
//   - `insertMention`  — writing a picked path back into the textarea
//
// The token-boundary rules are the ones Codex and Claude Code both had to learn
// the hard way (openai/codex #12643, #4012):
//
//   - `@` starts a token only at the start of the string or after whitespace, so
//     `foo@bar` and `npx -y @scope/pkg@latest` do not open the picker.
//   - An unquoted token ends at the first whitespace; `@"a path with spaces"`
//     runs to the closing quote, because Luma's paths are root-relative and a
//     space would otherwise silently split the name in two.

/**
 * The mention token the caret sits inside, or null.
 *
 * @param {string} text
 * @param {number} caret - index into `text`
 * @returns {{ start: number, end: number, query: string } | null}
 *   `start` is the `@`, `end` is the caret. `[start, end)` is the range a pick
 *   replaces, so a result must be replaced where it was found rather than by
 *   recomputing boundaries from the cursor (codex #31190).
 */
export function activeMention(text, caret) {
  if (typeof text !== "string") return null;
  if (!Number.isInteger(caret) || caret < 0 || caret > text.length) return null;

  const at = text.lastIndexOf("@", caret - 1);
  if (at === -1) return null;
  // `lastIndexOf` clamps a negative `fromIndex` to 0, so a caret at the very
  // start would otherwise "find" an `@` that is actually ahead of it.
  if (at >= caret) return null;
  // Token boundary: `@` after a non-space is not a mention (`foo@bar`).
  if (at > 0 && !/\s/.test(text[at - 1])) return null;

  const rest = text.slice(at + 1, caret);
  if (rest.startsWith('"')) {
    const body = rest.slice(1);
    const close = body.indexOf('"');
    if (close === -1) return { start: at, end: caret, query: body };
    // The quote already closed before the caret, so the token is behind us —
    // this is what keeps the popup from reopening on the space we insert.
    if (close + 1 < body.length) return null;
    return { start: at, end: caret, query: body.slice(0, close) };
  }
  // Unquoted: any whitespace between the `@` and the caret ends the token.
  if (/\s/.test(rest)) return null;
  return { start: at, end: caret, query: rest };
}

/**
 * Every file reference in a finished message, in the order they appear.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {boolean} [options.multiRoot=false] - more than one folder attached, so
 *   a label may be `alias:path` (the form search results and the system prompt
 *   use). With a single root there is no prefix and no colon to split on.
 * @returns {Array<{ root: string | undefined, path: string }>}
 */
export function parseMentions(text, { multiRoot = false } = {}) {
  if (typeof text !== "string" || text === "") return [];
  const out = [];
  const re = /(^|\s)@(?:"([^"]*)"|(\S+))/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    let label = match[2] !== undefined ? match[2] : match[3];
    // A second `@` inside the token means this was not a file reference —
    // `@scope/pkg@latest` is an npm package, not a path (codex #12643).
    if (label.includes("@")) continue;
    // Trailing punctuation from prose ("see @a.ts.") is not part of the path.
    // A quoted label is taken verbatim, which is the escape hatch for a name
    // that really does end in one of these.
    if (match[2] === undefined) label = label.replace(/[.,;!?]+$/, "");
    if (label === "") continue;
    out.push(splitLabel(label, multiRoot));
  }
  return out;
}

function splitLabel(label, multiRoot) {
  if (!multiRoot) return { root: undefined, path: label };
  const colon = label.indexOf(":");
  if (colon === -1) return { root: undefined, path: label };
  return { root: label.slice(0, colon), path: label.slice(colon + 1) };
}

/**
 * Replace the token a pick targeted with `@label` and a trailing space, so the
 * mention is closed and the user can keep typing.
 *
 * @returns {{ text: string, caret: number }} the new text and where the caret
 *   should land (set via `selectionStart`/`selectionEnd`, the way the prefill
 *   effect in `InputArea` already moves it).
 */
export function insertMention(text, mention, label) {
  const token = /\s/.test(label) ? `@"${label}" ` : `@${label} `;
  const next = text.slice(0, mention.start) + token + text.slice(mention.end);
  return { text: next, caret: mention.start + token.length };
}

/**
 * Lines a mention may pull from one file.
 *
 * A mention is a pointer plus a useful excerpt, not a file dump. Measured on a
 * 21,668-line Ruby file (~47 bytes/line), the default 2000-line read was 94 KB:
 * 59% of the whole run's file budget and 85% of the first round's context, and
 * the run was then cut off by that budget. 600 lines is ~28 KB on the same file,
 * and `read_file`'s own result notice still tells the model the total length and
 * the offset to continue from — which it used correctly in that run.
 */
export const MENTION_READ_LIMIT = 600;

/**
 * Read the files a message references, for the per-turn context block.
 *
 * `readFile(path, root, options)` is the same read-only, root-bounded call the
 * model makes — so a mention cannot reach outside the attached roots, and a bad
 * path comes back as an observation rather than throwing. It is bounded to
 * `MENTION_READ_LIMIT` lines so one huge file cannot take the run's budget.
 *
 * Stops once the byte budget is spent (the reads are charged against the run's
 * `maxFileBytes` by the caller, or a mention would be a budget bypass).
 *
 * @returns {Promise<{ content: string, bytes: number, calls: number } | null>}
 *   null when the message references nothing.
 */
export async function buildMentionContext({
  text,
  multiRoot = false,
  readFile,
  maxBytes = 0,
}) {
  const mentions = parseMentions(text, { multiRoot });
  if (mentions.length === 0) return null;

  const parts = [];
  let bytes = 0;
  let calls = 0;
  for (const mention of mentions) {
    if (maxBytes > 0 && bytes >= maxBytes) break;
    const result = await readFile(mention.path, mention.root, {
      limit: MENTION_READ_LIMIT,
    });
    calls += 1;
    const body = typeof result === "string" ? result : String(result ?? "");
    bytes += body.length;
    const label = mention.root ? `${mention.root}:${mention.path}` : mention.path;
    parts.push(`--- ${label} ---\n${body}`);
  }
  if (parts.length === 0) return null;

  const content = [
    "The user referenced the following project files with @. Their contents are already included below, with line numbers as `12→text` like read_file — do not read them again.",
    "",
    parts.join("\n\n"),
  ].join("\n");
  return { content, bytes, calls };
}
