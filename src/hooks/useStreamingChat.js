import { useCallback } from "react";
import { streamChat } from "../lib/ollama";
import { TOOLS, executeTool } from "../lib/tools";
import { buildMainChatSystemPrompt, buildSideChatSystemPrompt } from "../lib/systemPrompt";
import { useChatSession } from "./useChatSession";

export function useStreamingChat({ store, contextStore, compact, sideChatId, sessionId }) {
  const {
    model,
    isStreaming,
    error,
    addMessage,
    addStreamingMessage,
    updateStreamingMessage,
    addToolCall,
    completeToolCall,
    finalizeMessage,
    setError,
    clearError,
    setAbortController,
    stopStreaming,
    getApiMessages,
  } = store();

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

      clearError();

      const isFirstMessage = store.getState().messages.length === 0;
      addMessage("user", text, images);

      let currentSessionId = activeChatId;
      if (!compact && isFirstMessage) currentSessionId = createSession(text, model);

      const streamId = addStreamingMessage();
      let currentCallId = null;
      const ctrl = new AbortController();
      setAbortController(ctrl);

      try {
        const apiMessages = getApiMessages().filter(
          (m) => m.content !== "" || (m.images && m.images.length > 0),
        );

        const appSystemPrompt = compact
          ? buildSideChatSystemPrompt()
          : buildMainChatSystemPrompt();

        const systemMessages = [{ role: "system", content: appSystemPrompt }];

        if (contextStore) {
          const ctxMessages = contextStore.getState().getApiMessages();
          if (ctxMessages.length > 0) {
            const transcript = ctxMessages
              .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
              .join("\n\n");
            systemMessages.push({
              role: "system",
              content: `The following is the conversation from the main chat. Use it as context when answering the user's questions.\n\n${transcript}`,
            });
          }
        }

        await streamChat({
          model,
          messages: [...systemMessages, ...apiMessages],
          tools: TOOLS,
          executeTool,
          onToken: (_, full) => updateStreamingMessage(streamId, full),
          onToolCall: (name, args) => {
            currentCallId = addToolCall(streamId, name, args);
          },
          onToolResult: (_, result) => {
            if (currentCallId) {
              const isError = typeof result === "string" && result.startsWith("Error:");
              completeToolCall(streamId, currentCallId, {
                result: isError ? null : result,
                error: isError ? result : null,
              });
              currentCallId = null;
            }
          },
          onDone: (full) => {
            finalizeMessage(streamId, full);
            saveOnReply(streamId, full, model, currentSessionId);
          },
          signal: ctrl.signal,
        });
      } catch (err) {
        if (err.name === "AbortError") {
          finalizeMessage(
            streamId,
            store.getState().messages.find((m) => m.id === streamId)?.content || "",
          );
        } else {
          finalizeMessage(streamId, "");
          setError(err.message);
        }
      }
    },
    [isStreaming, model, activeChatId, compact],
  );

  return { handleSend, isStreaming, stopStreaming, error, clearError };
}
