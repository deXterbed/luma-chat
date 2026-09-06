import { useCallback, useRef } from "react";
import { streamChat } from "../lib/ollama";
import { TOOLS, executeTool } from "../lib/tools";
import {
  buildMainChatSystemPrompt,
  buildSideChatSystemPrompt,
} from "../lib/systemPrompt";
import { buildFollowUpMessages, parseSubtopics } from "../lib/followups";
import { useChatSession } from "./useChatSession";
import { useSettingsStore } from "../store/settingsStore";

export function useStreamingChat({
  store,
  contextStore,
  compact,
  sideChatId,
  sessionId,
  webSearchEnabled,
  thinkingEnabled,
}) {
  // Subscribe only to values that drive re-renders or guard logic
  const model = store((s) => s.model);
  const isStreaming = store((s) => s.isStreaming);
  const error = store((s) => s.error);

  const { activeChatId, createSession, saveNow, saveOnReply } = useChatSession({
    sideChatId,
    sessionId,
    store,
  });

  // Shared streaming pipeline. `afterMessageId` is set when re-sending after
  // an inline edit (so the new assistant turn won't re-create the session or
  // re-add a user message). For normal sends it's undefined.
  const runStream = useCallback(
    async ({ text, images = [], afterMessageId }) => {
      // Use store.getState() for all imperative calls inside the callback so
      // async callbacks (onToken, onDone, etc.) always read fresh state rather
      // than stale closures captured at render time.
      store.getState().clearError();

      const isFirstMessage = store.getState().messages.length === 0;
      if (!afterMessageId) {
        store.getState().addMessage("user", text, images);
      }

      let currentSessionId = activeChatId;
      if (!sideChatId && isFirstMessage && !afterMessageId) {
        currentSessionId = createSession(text, model);
      }

      // Persist the user message before streaming starts so it survives a
      // crash, close, or error mid-generation.
      saveNow(currentSessionId, model);

      const streamId = store.getState().addStreamingMessage();
      // Parallel tool execution means multiple calls can be in flight at once,
      // so track each call's id by its index in the round's tool_calls batch
      // (the index onToolCall/onToolResult now carry) instead of a single id.
      const pendingCallIds = new Map();
      const ctrl = new AbortController();
      store.getState().setAbortController(ctrl);

      // Throttle token updates to rAF cadence (~60fps). Without this, fast
      // models trigger Zustand set() hundreds of times per second, causing
      // every MessageBubble to re-render on every token.
      const pendingContent = { current: null, rafId: null };
      const flushToken = () => {
        pendingContent.rafId = null;
        if (ctrl.signal.aborted) return;
        if (pendingContent.current !== null) {
          store.getState().updateStreamingMessage(streamId, pendingContent.current);
          pendingContent.current = null;
        }
      };

      const pendingThinking = { current: null, rafId: null };
      const flushThinking = () => {
        pendingThinking.rafId = null;
        if (ctrl.signal.aborted) return;
        if (pendingThinking.current !== null) {
          store.getState().updateThinking(streamId, pendingThinking.current);
          pendingThinking.current = null;
        }
      };

      try {
        const apiMessages = store
          .getState()
          .getApiMessages()
          .filter((m) => m.content !== "" || (m.images && m.images.length > 0));

        const appSystemPrompt = compact
          ? buildSideChatSystemPrompt(webSearchEnabled)
          : buildMainChatSystemPrompt(webSearchEnabled);

        const systemMessages = [{ role: "system", content: appSystemPrompt }];

        if (contextStore) {
          const ctxMessages = contextStore.getState().getApiMessages();
          if (ctxMessages.length > 0) {
            // Limit to the most recent 10 messages to avoid overflowing small
            // local model context windows on long sessions.
            const recent = ctxMessages.slice(-10);
            let transcript = recent
              .map(
                (m) =>
                  `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`,
              )
              .join("\n\n");
            if (transcript.length > 4000) {
              transcript = "…" + transcript.slice(-4000);
            }
            const ctxSystem = {
              role: "system",
              content: `The following is the recent conversation from the main chat. Use it as context when answering the user's questions.\n\n${transcript}`,
            };
            systemMessages.push(ctxSystem);
          }
        }

        const activeTools = webSearchEnabled
          ? TOOLS
          : TOOLS.filter(
              (t) => !["web_search", "web_fetch"].includes(t.function.name),
            );

        // Best-effort follow-up subtopic generation, fired from onDone after
        // the answer finalizes. Reads the recent conversation from the store,
        // runs a focused one-shot call (no tools), parses the JSON, and attaches
        // the chips to the finished message. Swallows all errors — chips are a
        // progressive enhancement, never a hard failure.
        const generateSubtopics = async (messageId) => {
          try {
            const recent = store.getState().getApiMessages().slice(-4);
            if (recent.length === 0) return;
            let raw = "";
            await streamChat({
              model,
              messages: buildFollowUpMessages(recent),
              tools: [],
              think: false,
              // Reuse the pane's abort signal so Stop / sending a new message
              // cancels this follow-up call too — otherwise it keeps running
              // (consuming quota/network) after the user has moved on.
              signal: ctrl.signal,
              onDone: (full) => {
                raw = full;
              },
            });
            const subs = parseSubtopics(raw);
            if (subs.length > 0) store.getState().setSubtopics(messageId, subs);
          } catch {
            // follow-up generation is best-effort; never surface an error
          }
        };

        await streamChat({
          model,
          messages: [...systemMessages, ...apiMessages],
          tools: activeTools,
          executeTool,
          think: thinkingEnabled,
          toolCallLimit: useSettingsStore.getState().toolCallLimit,
          onToken: (_, full) => {
            pendingContent.current = full;
            if (pendingContent.rafId === null) {
              pendingContent.rafId = requestAnimationFrame(flushToken);
            }
          },
          onThinking: (_, full) => {
            pendingThinking.current = full;
            if (pendingThinking.rafId === null) {
              pendingThinking.rafId = requestAnimationFrame(flushThinking);
            }
          },
          onToolCall: (name, args, index) => {
            pendingCallIds.set(
              index,
              store.getState().addToolCall(streamId, name, args),
            );
          },
          onToolResult: (_, result, index) => {
            const callId = pendingCallIds.get(index);
            if (callId) {
              const isError =
                typeof result === "string" && result.startsWith("Error:");
              store.getState().completeToolCall(streamId, callId, {
                result: isError ? null : result,
                error: isError ? result : null,
              });
              pendingCallIds.delete(index);
            }
          },
          onDone: (full) => {
            if (pendingContent.rafId !== null) {
              cancelAnimationFrame(pendingContent.rafId);
              pendingContent.rafId = null;
            }
            if (pendingThinking.rafId !== null) {
              cancelAnimationFrame(pendingThinking.rafId);
              pendingThinking.rafId = null;
            }
            store.getState().finalizeMessage(streamId, full);
            saveOnReply(streamId, full, model, currentSessionId);
            // Fire-and-forget: generate clickable follow-up chips via a
            // dedicated one-shot call after the answer finalizes. The model
            // won't reliably call a side-effect "suggest" tool on follow-up
            // turns, so we decouple it into its own focused inference. Best
            // effort — never surfaces an error or blocks the UI. Subtopics are
            // transient (not persisted), like `thinking`.
            generateSubtopics(streamId);
          },
          signal: ctrl.signal,
        });
      } catch (err) {
        if (pendingContent.rafId !== null) {
          cancelAnimationFrame(pendingContent.rafId);
          pendingContent.rafId = null;
        }
        if (pendingThinking.rafId !== null) {
          cancelAnimationFrame(pendingThinking.rafId);
          pendingThinking.rafId = null;
        }
        if (err.name === "AbortError" || err.message === "aborted") {
          const partial =
            store.getState().messages.find((m) => m.id === streamId)
              ?.content || "";
          store.getState().finalizeMessage(streamId, partial);
          saveNow(currentSessionId, model);
        } else {
          store.getState().finalizeMessage(streamId, "");
          store.getState().setError(err.message);
          saveNow(currentSessionId, model);
        }
      }
    },
    [
      activeChatId,
      compact,
      contextStore,
      createSession,
      model,
      saveNow,
      saveOnReply,
      store,
      thinkingEnabled,
      webSearchEnabled,
    ],
  );

  const handleSend = useCallback(
    async (text, images = []) => {
      if (!text && images.length === 0) return;
      if (isStreaming) return;
      await runStream({ text, images });
    },
    [isStreaming, runStream],
  );

  // Re-send after inline-editing a user message. `afterMessageId` is the
  // edited user message — we truncate everything after it and stream a new
  // assistant reply. Same logic as a fresh send, but the edited message is
  // already in the store (no new addMessage).
  const resend = useCallback(
    async (afterMessageId, text) => {
      if (isStreaming) return;
      store.getState().truncateAfter(afterMessageId);
      store.getState().editMessage(afterMessageId, text);
      store.getState().clearError();
      await runStream({ text, images: [], afterMessageId });
    },
    [isStreaming, runStream, store],
  );

  return {
    handleSend,
    resend,
    isStreaming,
    error,
    stopStreaming: store.getState().stopStreaming,
    clearError: store.getState().clearError,
  };
}
