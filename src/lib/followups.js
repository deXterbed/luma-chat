// Follow-up subtopic generation via a dedicated one-shot model call.
//
// The model won't reliably call a side-effect "suggest subtopics" *tool* on
// follow-up turns (it skips it in favor of writing prose — verified against
// deepseek-v4-flash with real web search). So instead of a tool, we make a
// separate, focused inference after the answer finalizes whose ONLY job is to
// suggest 1-3 follow-up questions as JSON. Reliable because it's the model's
// sole task in that call. The chips are transient (not persisted to SQLite,
// like the thinking field) — they regenerate per answer and vanish on reload.

// Build the messages for the follow-up call. `recentMessages` is a slice of
// the conversation (role + content); each message's content is truncated so a
// long answer doesn't blow out the context for this small call.
export function buildFollowUpMessages(recentMessages) {
  const transcript = recentMessages
    .map((m) => {
      const who = m.role === "user" ? "User" : "Assistant";
      const content = typeof m.content === "string" ? m.content : "";
      return `${who}: ${content.slice(0, 800)}`;
    })
    .join("\n\n");

  return [
    {
      role: "system",
      content:
        'You generate follow-up research questions for a research workbench. Reply ONLY with a JSON object: {"subtopics": [{"title": string, "prompt": string}]}. The array MUST contain between 1 and 3 items — never empty. Each title is a short 3-8 word label. Each prompt is a self-contained question the user could send as their next message.',
    },
    {
      role: "user",
      content: `Conversation so far:\n\n${transcript}\n\nGenerate 1-3 follow-up questions as JSON now.`,
    },
  ];
}

// Parse the follow-up call's raw content into a subtopics array. Tolerates
// models that wrap JSON in prose or ```json fences, and models that ignore the
// "JSON only" instruction. Returns at most 3 valid {title, prompt} items.
export function parseSubtopics(raw) {
  if (typeof raw !== "string" || !raw.trim()) return [];
  const candidate = extractJson(raw);
  if (!candidate) return [];
  try {
    const parsed = JSON.parse(candidate);
    const subs = Array.isArray(parsed?.subtopics) ? parsed.subtopics : [];
    return subs
      .filter(
        (s) =>
          s &&
          typeof s.title === "string" &&
          s.title.trim() &&
          typeof s.prompt === "string" &&
          s.prompt.trim(),
      )
      .slice(0, 3)
      .map((s) => ({ title: s.title.trim(), prompt: s.prompt.trim() }));
  } catch {
    return [];
  }
}

// Pull the first plausible JSON object out of raw text: a ```json fenced
// block, else the substring between the first '{' and the last '}'.
function extractJson(raw) {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) return raw.slice(start, end + 1);
  return null;
}