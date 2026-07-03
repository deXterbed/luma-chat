import { useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import { useSessionStore } from "../store/sessionStore";

export function useChatSession({ sideChatId, sessionId, store }) {
  // Subscribe narrowly: only `activeChatId` is reactive state. The rest are
  // store actions (stable refs in zustand), so selecting them by themselves
  // never triggers a re-render — and we avoid subscribing to `chatSessions`,
  // which would re-render every ChatPane on any session-list change.
  const activeChatId = useSessionStore((s) => s.activeChatId);
  const addChatSession = useSessionStore((s) => s.addChatSession);
  const updateChatSession = useSessionStore((s) => s.updateChatSession);
  const updateSideChat = useSessionStore((s) => s.updateSideChat);
  const setActiveChatId = useSessionStore((s) => s.setActiveChatId);

  const createSession = useCallback(
    (text, model) => {
      const id = uuidv4();
      addChatSession({ id, title: text.slice(0, 60), model });
      setActiveChatId(id);
      return id;
    },
    [addChatSession, setActiveChatId],
  );

  // Persist whatever messages are currently in the store. Used to save the
  // user message before streaming starts, and on abort/error so nothing is lost.
  const saveNow = useCallback(
    (currentSessionId, model) => {
      const msgs = store
        .getState()
        .messages.filter((m) => !m.isStreaming || m.content);
      if (!sideChatId && currentSessionId) {
        updateChatSession(currentSessionId, { messages: msgs, model });
      }
      if (sideChatId && sessionId) {
        updateSideChat(sessionId, sideChatId, { messages: msgs, model });
      }
    },
    [sideChatId, sessionId, store, updateChatSession, updateSideChat],
  );

  const saveOnReply = useCallback(
    (streamId, full, model, currentSessionId) => {
      const updatedMessages = store
        .getState()
        .messages.map((m) =>
          m.id === streamId ? { ...m, content: full, isStreaming: false } : m,
        );
      if (!sideChatId && currentSessionId) {
        updateChatSession(currentSessionId, {
          messages: updatedMessages,
          model,
        });
      }
      if (sideChatId && sessionId) {
        updateSideChat(sessionId, sideChatId, {
          messages: updatedMessages,
          model,
        });
      }
    },
    [sideChatId, sessionId, store, updateChatSession, updateSideChat],
  );

  return { activeChatId, createSession, saveNow, saveOnReply };
}
