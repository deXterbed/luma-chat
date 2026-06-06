import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../lib/db'

export const useAppStore = create((set, get) => ({
  sideChatOpen: false,
  availableModels: [],
  ollamaConnected: false,
  chatSessions: [],
  activeChatId: null,

  setSideChatOpen: (open) => set({ sideChatOpen: open }),
  toggleSideChat: () => set(s => ({ sideChatOpen: !s.sideChatOpen })),

  setAvailableModels: (models) => set({ availableModels: models, ollamaConnected: true }),
  setOllamaConnected: (v) => set({ ollamaConnected: v }),

  // Load all sessions from DB on startup (replaces in-memory state)
  setSessionsFromDb: (sessions) => set({ chatSessions: sessions }),

  addChatSession: (session) => {
    const full = { ...session, sideChats: [], activeSideChatId: null }
    set(s => ({ chatSessions: [full, ...s.chatSessions] }))
    db.saveSession({ id: session.id, title: session.title, model: session.model })
  },

  updateChatSession: (id, updates) => {
    set(s => ({ chatSessions: s.chatSessions.map(c => c.id === id ? { ...c, ...updates } : c) }))
    if (updates.messages) db.saveMessages(id, updates.messages)
    if (updates.model || updates.title) {
      const session = get().chatSessions.find(c => c.id === id)
      if (session) db.saveSession({ id, title: updates.title ?? session.title, model: updates.model ?? session.model })
    }
  },

  setActiveChatId: (id) => set({ activeChatId: id }),

  addSideChat: (sessionId, model = 'minimax-m3:cloud') => {
    const id = uuidv4()
    set(s => ({
      chatSessions: s.chatSessions.map(sess => {
        if (sess.id !== sessionId) return sess
        const position = (sess.sideChats || []).length
        db.upsertSideChat(sessionId, { id, model }, position)
        db.setActiveSideChat(sessionId, id)
        return { ...sess, sideChats: [...(sess.sideChats || []), { id, model, messages: [] }], activeSideChatId: id }
      })
    }))
  },

  updateSideChat: (sessionId, sideChatId, updates) => {
    set(s => ({
      chatSessions: s.chatSessions.map(sess =>
        sess.id === sessionId
          ? { ...sess, sideChats: sess.sideChats.map(sc => sc.id === sideChatId ? { ...sc, ...updates } : sc) }
          : sess
      )
    }))
    if (updates.messages) db.saveSideChatMessages(sideChatId, updates.messages)
    if (updates.model) db.upsertSideChat(sessionId, { id: sideChatId, model: updates.model }, 0)
  },

  setActiveSideChatId: (sessionId, sideChatId) => {
    set(s => ({
      chatSessions: s.chatSessions.map(sess =>
        sess.id === sessionId ? { ...sess, activeSideChatId: sideChatId } : sess
      )
    }))
    db.setActiveSideChat(sessionId, sideChatId)
  },
}))
