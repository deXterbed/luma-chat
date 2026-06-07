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

  return { activeChatId, createSession, saveOnReply }
}
