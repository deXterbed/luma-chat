---
paths: ["src/lib/ollama.js", "src/lib/ollamaStream.js", "src/hooks/useStreamingChat.js"]
---

# Streaming loop rules

Detail: `docs/architecture/streaming.md`. The loop is the most load-bearing code in the app; read it
before changing round policy, cancellation, or tool-result ordering.

- **Only a non-empty `tool_calls` array is kept** from a streamed chunk. Some models emit a trailing `tool_calls: []` that would otherwise wipe calls captured earlier in the round.
- **Tool results are appended in issue order, not completion order.** `runToolCalls` fires every `onToolCall` upfront, then emits results indexed by call position after the batch settles. That `index` arg is why in-flight calls are tracked in a `Map`, not a `currentCallId`.
- **`paneIsCurrent()` is the guard that makes an orphaned run harmless.** `chatNonce` captures pane identity at send time; `onDone` and the error path must return early when it moved. Without it a run writes the new session's messages into the old session's row.
- **Classifying a result as failed keys off the bare word `Error`**, so a new tool's ordinary messages must not begin with it.
- **Any new exit path must still fire `ollama://done`/`ollama://error`** and call `flushPending()` — the streaming cursor and the persisted thinking record depend on it.
- **`maxToolRounds` and `webSearchNudgeAt` key off the round number alone**, never off which tools ran. That is deliberate and documented; don't "fix" the nudge to check for searches.
