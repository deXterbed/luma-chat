import { useCallback, useRef } from "react";
import { streamChat } from "../lib/ollama";
import { TOOLS, executeTool } from "../lib/tools";
import {
  buildMainChatSystemPrompt,
  buildSideChatSystemPrompt,
} from "../lib/systemPrompt";
import { useChatSession } from "./useChatSession";

export function useStreamingChat({
  store,
  contextStore,
  compact,
  sideChatId,
  sessionId,
  webSearchEnabled,
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
      let currentCallId = null;
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
            systemMessages.push({
              role: "system",
              content: `The following is the recent conversation from the main chat. Use it as context when answering the user's questions.\n\n${transcript}`,
            });
          }
        }

        const activeTools = webSearchEnabled
          ? TOOLS
          : TOOLS.filter(
              (t) => !["web_search", "web_fetch"].includes(t.function.name),
            );

        await streamChat({
          model,
          messages: [...systemMessages, ...apiMessages],
          tools: activeTools,
          executeTool,
          onToken: (_, full) => {
            pendingContent.current = full;
            if (pendingContent.rafId === null) {
              pendingContent.rafId = requestAnimationFrame(flushToken);
            }
          },
          onToolCall: (name, args) => {
            currentCallId = store.getState().addToolCall(streamId, name, args);
          },
          onToolResult: (_, result) => {
            if (currentCallId) {
              const isError =
                typeof result === "string" && result.startsWith("Error:");
              store.getState().completeToolCall(streamId, currentCallId, {
                result: isError ? null : result,
                error: isError ? result : null,
              });
              currentCallId = null;
            }
          },
          onDone: (full) => {
            if (pendingContent.rafId !== null) {
              cancelAnimationFrame(pendingContent.rafId);
              pendingContent.rafId = null;
            }
            store.getState().finalizeMessage(streamId, full);
            saveOnReply(streamId, full, model, currentSessionId);
          },
          signal: ctrl.signal,
        });
      } catch (err) {
        if (pendingContent.rafId !== null) {
          cancelAnimationFrame(pendingContent.rafId);
          pendingContent.rafId = null;
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
