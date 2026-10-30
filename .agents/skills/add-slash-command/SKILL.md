---
name: add-slash-command
description: Add a new slash command to the composer palette. Use when adding or changing an entry in the COMMANDS registry.
---

- **Add a slash command** — one entry in `COMMANDS` (`src/lib/commands.js`); `InputArea` renders the registry as the `/` palette and `useStreamingChat` expands the choice, so nothing else changes. Expansion is applied to the outgoing `apiMessages` in `runStream`, **not** in the store: the bubble and the session title (`createSession` uses `text.slice(0, 60)`) keep the short `/command` while the model gets the instruction. The palette opens only while the input matches `/^\/\S*$/` (a bare token, no whitespace), so a space closes it and `Enter` sends normally — that is also what lets args through (`/summarise keep it to 3 bullets` appends the text to the instruction). Array order is the default highlight, and `Tab` completes in place rather than sending.
