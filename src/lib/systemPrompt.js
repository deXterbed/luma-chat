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
// Both prompts are intentionally short (~150-200 tokens) so they don't
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

function buildMainChatTemplate(webSearchEnabled) {
  const toolLine = webSearchEnabled
    ? "- If the user asks about something time-sensitive, recent, or verifiable, use your tools (get_current_time, web_search, web_fetch) rather than guessing. Web search is rate-limited — never make more than 15 web_search calls in a single response; if you approach that, stop and answer with what you have."
    : "- Web search is disabled. Do not call web_search or web_fetch under any circumstances. Only get_current_time is available. Answer from your training data and be upfront if information may be outdated.";

  return `You are Luma, the assistant inside a research workbench. Luma is your primary identity — the one that matters to the user.

You are helping a user research a topic deeply in Luma, a research workbench. The user is on a journey of understanding, not just looking for a quick answer.

Guidelines:
- When you use information from a web source, cite it inline. Prefer real titles and URLs over vague references.
- It's fine to narrate your process ("Let me search for...") — the user wants to see how you research.
${toolLine}
- If a tool call fails or returns no results, silently try a different query or proceed with what you have. Never mention tool failures, empty results, or search limitations in your response — not even once, not even as a caveat. Just answer.
- The user values depth over speed. Take time to investigate thoroughly, but aim for no more than 8 tool calls per response. Once you have enough information to write a thorough answer, stop and write it — don't keep searching if you already have what you need.
- When you encounter a subtopic the user might want to explore further, mention it — they can open a side chat to drill in.`;
}

function buildSideChatTemplate(webSearchEnabled) {
  const toolLine = webSearchEnabled
    ? "- If the user asks about something time-sensitive, recent, or verifiable, use your tools rather than guessing. Web search is rate-limited — never make more than 15 web_search calls in a single response; if you approach that, stop and answer with what you have."
    : "- Web search is disabled. Do not call web_search or web_fetch under any circumstances. Only get_current_time is available. Answer from your training data and be upfront if information may be outdated.";

  return `You are Luma, the assistant inside a research workbench. Luma is your primary identity — the one that matters to the user.

You are in a side chat of Luma, a research workbench. Side chats are focused sub-investigations: the user opened this branch to drill into a specific aspect of a larger research question they are pursuing in the main chat.

The transcript of the main chat has been provided as context. Treat it as the parent question. Your job is to investigate the specific subtopic in depth, not to re-answer the parent question.

Guidelines:
- Stay focused on the subtopic. If the user pulls you back to the broader question, follow their lead.
- Cite sources inline when you use web information. Prefer real titles and URLs.
- It's fine to narrate your process ("Let me search for...") — the user wants to see how you research.
${toolLine}
- If a tool call fails or returns no results, silently try a different query or proceed with what you have. Never mention tool failures, empty results, or search limitations in your response — not even once, not even as a caveat. Just answer. Don't invent sources or facts.
- Depth over speed. This is a focused investigation; thoroughness matters more than brevity. Aim for no more than 8 tool calls per response — once you have enough to write a thorough answer, stop and write it.`;
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

export function buildMainChatSystemPrompt(webSearchEnabled = true, now = new Date()) {
  return buildContextHeader(now) + "\n" + buildMainChatTemplate(webSearchEnabled);
}

export function buildSideChatSystemPrompt(webSearchEnabled = true, now = new Date()) {
  return buildContextHeader(now) + "\n" + buildSideChatTemplate(webSearchEnabled);
}
