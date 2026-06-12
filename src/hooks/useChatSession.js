import { useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useSessionStore } from '../store/sessionStore'

export function useChatSession({ compact, sideChatId, sessionId, store }) {
  const { activeChatId, addChatSession, updateChatSession, updateSideChat, setActiveChatId } = useSessionStore()

  const createSession = useCallback((text, model) => {
    const id = uuidv4()
    addChatSession({ id, title: text.slice(0, 60), model })
    setActiveChatId(id)
    return id
  }, [addChatSession, setActiveChatId])

  // Persist whatever messages are currently in the store. Used to save the
  // user message before streaming starts, and on abort/error so nothing is lost.
  const saveNow = useCallback((currentSessionId, model) => {
    const msgs = store.getState().messages.filter(m => !m.isStreaming || m.content)
    if (!compact && currentSessionId) {
      updateChatSession(currentSessionId, { messages: msgs, model })
    }
    if (sideChatId && sessionId) {
      updateSideChat(sessionId, sideChatId, { messages: msgs, model })
    }
  }, [compact, sideChatId, sessionId, store, updateChatSession, updateSideChat])

  const saveOnReply = useCallback((streamId, full, model, currentSessionId) => {
    const updatedMessages = store.getState().messages.map(m =>
      m.id === streamId ? { ...m, content: full, isStreaming: false } : m
    )
    if (!compact && currentSessionId) {
      updateChatSession(currentSessionId, { messages: updatedMessages, model })
    }
    if (sideChatId && sessionId) {
      updateSideChat(sessionId, sideChatId, { messages: updatedMessages, model })
    }
  }, [compact, sideChatId, sessionId, store, updateChatSession, updateSideChat])

  return { activeChatId, createSession, saveNow, saveOnReply }
}
