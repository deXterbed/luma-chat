import { useCallback } from "react";
import { streamChat } from "../lib/ollama";
import { TOOLS, executeTool } from "../lib/tools";
import { buildMainChatSystemPrompt, buildSideChatSystemPrompt } from "../lib/systemPrompt";
import { useChatSession } from "./useChatSession";

export function useStreamingChat({ store, contextStore, compact, sideChatId, sessionId, webSearchEnabled }) {
  // Subscribe only to values that drive re-renders or guard logic
  const model = store((s) => s.model);
  const isStreaming = store((s) => s.isStreaming);
  const error = store((s) => s.error);

  const { activeChatId, createSession, saveOnReply } = useChatSession({
    compact,
    sideChatId,
    sessionId,
    store,
  });

  const handleSend = useCallback(
    async (text, images = []) => {
      if (!text && images.length === 0) return;
      if (isStreaming) return;

      // Use store.getState() for all imperative calls inside the callback so
      // async callbacks (onToken, onDone, etc.) always read fresh state rather
      // than stale closures captured at render time.
      store.getState().clearError();

      const isFirstMessage = store.getState().messages.length === 0;
      store.getState().addMessage("user", text, images);

      let currentSessionId = activeChatId;
      if (!compact && isFirstMessage) currentSessionId = createSession(text, model);

      const streamId = store.getState().addStreamingMessage();
      let currentCallId = null;
      const ctrl = new AbortController();
      store.getState().setAbortController(ctrl);

      try {
        const apiMessages = store.getState().getApiMessages().filter(
          (m) => m.content !== "" || (m.images && m.images.length > 0),
        );

        const appSystemPrompt = compact
          ? buildSideChatSystemPrompt()
          : buildMainChatSystemPrompt();

        const systemMessages = [{ role: "system", content: appSystemPrompt }];

        if (contextStore) {
          const ctxMessages = contextStore.getState().getApiMessages();
          if (ctxMessages.length > 0) {
            // Limit to the most recent 10 messages to avoid overflowing small
            // local model context windows on long sessions.
            const recent = ctxMessages.slice(-10);
            let transcript = recent
              .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
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
          : TOOLS.filter((t) => !["web_search", "web_fetch"].includes(t.function.name));

        await streamChat({
          model,
          messages: [...systemMessages, ...apiMessages],
          tools: activeTools,
          executeTool,
          onToken: (_, full) => store.getState().updateStreamingMessage(streamId, full),
          onToolCall: (name, args) => {
            currentCallId = store.getState().addToolCall(streamId, name, args);
          },
          onToolResult: (_, result) => {
            if (currentCallId) {
              const isError = typeof result === "string" && result.startsWith("Error:");
              store.getState().completeToolCall(streamId, currentCallId, {
                result: isError ? null : result,
                error: isError ? result : null,
              });
              currentCallId = null;
            }
          },
          onDone: (full) => {
            store.getState().finalizeMessage(streamId, full);
            saveOnReply(streamId, full, model, currentSessionId);
          },
          signal: ctrl.signal,
        });
      } catch (err) {
        if (err.name === "AbortError") {
          store.getState().finalizeMessage(
            streamId,
            store.getState().messages.find((m) => m.id === streamId)?.content || "",
          );
        } else {
          store.getState().finalizeMessage(streamId, "");
          store.getState().setError(err.message);
        }
      }
    },
    [isStreaming, model, activeChatId, compact, webSearchEnabled, store, contextStore, saveOnReply, createSession],
  );

  return {
    handleSend,
    isStreaming,
    error,
    stopStreaming: store.getState().stopStreaming,
    clearError: store.getState().clearError,
  };
}
