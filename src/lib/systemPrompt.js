// System prompts sent to the model as the first message of every
// conversation. They shape the model's behavior toward the app's
// research-workbench goals: depth over speed, visible research process,
// cited sources, honesty about limits.
//
// Whatever model the user has selected (local or cloud) has its own
// system prompt baked into its weights or Modelfile. These prompts are
// additive — they layer on top of the model's defaults rather than
// fighting them. We establish Luma as the primary identity the user sees,
// while letting the model be honest about its underlying engine if asked
// directly. This is the same approach Claude.ai, Cursor, and other well-
// designed AI products take.
//
// Both prompts are intentionally short (~150-250 tokens) so they don't
// eat into the model's effective context window on every call. We don't
// hardcode a model name here — Luma should work with any compatible
// model, and the model knows its own identity better than we do.
//
// The prompts are FUNCTIONS (not constants) because we inject the current
// date and user's local timezone at the top. Without this, the model has
// to use `get_current_time` even for a simple "what's today's date?"
// question, and (worse) it relies on its training-data date as a proxy
// for "current" when formulating search queries. Injecting the real date
// removes both problems.
//
// ## Codebase mode
//
// When a project root is attached (`codebase: true`) two of the clauses below
// are *replaced*, not supplemented — the chat-mode wording actively fights
// repository exploration:
//
//   - "never mention tool failures… not even once" is right for web search but
//     wrong for a wrong path, which the model must visibly correct.
//   - "no more than 8 tool calls" caps exactly the loop that reading a repo
//     needs.
//
// Both side and main templates take the flag: a side chat inherits its
// session's attached folder, so it needs the same guidance.

import { FILE_TOOL_NAMES } from "./tools";

/**
 * @param {object} options
 * @param {boolean} [options.webSearchEnabled=true]
 * @param {boolean} [options.codebase=false] - a project folder is attached
 * @param {Date} [options.now=new Date()]
 */

function webToolLine(webSearchEnabled, codebase) {
  if (codebase) {
    return webSearchEnabled
      ? "- Web search is also available if the question needs something outside the project. It is rate-limited — never make more than 15 web_search calls in a single response."
      : "- Web search is disabled in this chat. Do not call web_search or web_fetch under any circumstances; everything you need is in the attached project folder.";
  }
  return webSearchEnabled
    ? "- If the user asks about something time-sensitive, recent, or verifiable, use your tools (get_current_time, web_search, web_fetch) rather than guessing. Web search is rate-limited — never make more than 15 web_search calls in a single response; if you approach that, stop and answer with what you have."
    : "- Web search is disabled. Do not call web_search or web_fetch under any circumstances. Only get_current_time is available. Answer from your training data and be upfront if information may be outdated.";
}

function fileToolLine() {
  return `- You have read-only access to the project folder attached to this chat: ${FILE_TOOL_NAMES.join(", ")}. Paths are relative to the project root — never absolute, never containing '..'. Search to find where something lives, then read it before saying what it does. Nothing outside the attached folder is readable.`;
}

// Chat mode hides tool failures (they're noise for a research answer); codebase
// mode must not, because the model has to correct its own wrong paths.
function failureLine(codebase) {
  return codebase
    ? "If a path doesn't exist or a search finds nothing, say briefly what you were looking for and try a different path or query. Never claim a file said something you did not actually read."
    : "If a tool call fails or returns no results, silently try a different query or proceed with what you have. Never mention tool failures, empty results, or search limitations in your response — not even once, not even as a caveat. Just answer.";
}

function budgetLine(codebase) {
  return codebase
    ? "Depth over speed. Search first to find the right files instead of guessing at paths, and read only the parts you need — your tool budget is finite, so spend it narrowing rather than re-reading. Once you can answer well, write the answer."
    : "The user values depth over speed. Take time to investigate thoroughly, but aim for no more than 8 tool calls per response. Once you have enough information to write a thorough answer, stop and write it — don't keep searching if you already have what you need.";
}

function buildMainChatTemplate({ webSearchEnabled, codebase }) {
  return `You are Luma, the assistant inside a research workbench. Luma is your primary identity — the one that matters to the user.

You are helping a user research a topic deeply in Luma, a research workbench. The user is on a journey of understanding, not just looking for a quick answer.

Guidelines:
- When you use information from a web source, cite it inline. Prefer real titles and URLs over vague references.
- It's fine to narrate your process ("Let me search for...") — the user wants to see how you research.
${webToolLine(webSearchEnabled, codebase)}${codebase ? `\n${fileToolLine()}` : ""}
- ${failureLine(codebase)}
- ${budgetLine(codebase)}`;
}

function buildSideChatTemplate({ webSearchEnabled, codebase }) {
  return `You are Luma, the assistant inside a research workbench. Luma is your primary identity — the one that matters to the user.

You are in a side chat of Luma, a research workbench. Side chats are focused sub-investigations: the user opened this branch to drill into a specific aspect of a larger research question they are pursuing in the main chat.

The transcript of the main chat has been provided as context. Treat it as the parent question. Your job is to investigate the specific subtopic in depth, not to re-answer the parent question.

Guidelines:
- Stay focused on the subtopic. If the user pulls you back to the broader question, follow their lead.
- Cite sources inline when you use web information. Prefer real titles and URLs.
- It's fine to narrate your process ("Let me search for...") — the user wants to see how you research.
${webToolLine(webSearchEnabled, codebase)}${codebase ? `\n${fileToolLine()}` : ""}
- ${failureLine(codebase)}
- This is a focused investigation; thoroughness matters more than brevity. ${budgetLine(codebase)} Don't invent sources or facts.`;
}

/**
 * Format a Date as "YYYY-MM-DD (Weekday)" in the user's local timezone.
 * Example: "2026-06-07 (Sunday)".
 */
function formatDate(now, timeZone) {
  const iso = now.toLocaleDateString("en-CA", { timeZone }); // YYYY-MM-DD
  const weekday = now.toLocaleDateString("en-US", {
    timeZone,
    weekday: "long",
  });
  return `${iso} (${weekday})`;
}

/**
 * Build the current-context header that gets prepended to every prompt.
 * Includes today's date and the user's local timezone so the model has
 * a real anchor for time-sensitive reasoning without needing a tool call.
 */
function buildContextHeader(now = new Date()) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = formatDate(now, tz);
  return `Current date: ${date}\nUser's local timezone: ${tz}\n`;
}

export function buildMainChatSystemPrompt({
  webSearchEnabled = true,
  codebase = false,
  now = new Date(),
} = {}) {
  return (
    buildContextHeader(now) +
    "\n" +
    buildMainChatTemplate({ webSearchEnabled, codebase })
  );
}

export function buildSideChatSystemPrompt({
  webSearchEnabled = true,
  codebase = false,
  now = new Date(),
} = {}) {
  return (
    buildContextHeader(now) +
    "\n" +
    buildSideChatTemplate({ webSearchEnabled, codebase })
  );
}
