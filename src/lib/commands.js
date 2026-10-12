// Slash commands: a `/`-triggered shortcut for an instruction the model
// already handles when it's typed as prose. The whole conversation is in
// context on every turn, so `/summarise` and `/layman` only save the typing —
// no new model capability and no backend work.
//
// The registry is shared. `InputArea` renders it as the autocomplete palette;
// `useStreamingChat` expands the selected command into its `instruction` at
// the send boundary. Expanding there (not in the store) keeps the bubble and
// the session title showing the compact thing the user typed, while the model
// receives the full instruction.

export const COMMANDS = [
  // Order is the palette's default highlight: the first entry is selected when
  // the list opens, so /layman — the one reached for most — sits on top.
  {
    name: "/layman",
    description: "Explain your last answer in plain language",
    instruction:
      "Rewrite your previous answer in plain language for a non-expert: no jargon, short sentences, and define or replace any technical term you would otherwise have to use.",
  },
  {
    name: "/summarise",
    description: "Summarise this conversation so far",
    instruction:
      "Summarise this conversation so far: the questions asked, the key findings, and any open threads. Use short sections or bullets.",
  },
];

// Commands whose name starts with the typed `/...` token. An empty token
// (just "/") matches all of them.
export function matchCommands(prefix) {
  const p = (prefix || "").toLowerCase();
  return COMMANDS.filter((c) => c.name.startsWith(p));
}

// Rewrite the last user turn's slash command into its instruction, leaving the
// stored message untouched. Any text after the command is appended as extra
// guidance. Messages with no recognised command are returned unchanged.
export function expandCommands(messages) {
  const i = messages.findLastIndex((m) => m.role === "user");
  if (i === -1) return messages;

  const content =
    typeof messages[i].content === "string" ? messages[i].content : "";
  const space = content.search(/\s/);
  const token = (space === -1 ? content : content.slice(0, space)).toLowerCase();
  const cmd = COMMANDS.find((c) => c.name === token);
  if (!cmd) return messages;

  const args = space === -1 ? "" : content.slice(space).trim();
  const out = messages.slice();
  out[i] = {
    ...messages[i],
    content: args ? `${cmd.instruction}\n\n${args}` : cmd.instruction,
  };
  return out;
}
