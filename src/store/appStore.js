import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'

export const useAppStore = create((set) => ({
  sideChatOpen: false,
  availableModels: [],
  ollamaConnected: false,
  chatSessions: [],
  activeChatId: null,

  setSideChatOpen: (open) => set({ sideChatOpen: open }),
  toggleSideChat: () => set(s => ({ sideChatOpen: !s.sideChatOpen })),

  setAvailableModels: (models) => set({ models, ollamaConnected: true }),
  setOllamaConnected: (v) => set({ ollamaConnected: v }),

  addChatSession: (session) =>
    set(s => ({ chatSessions: [{ ...session, sideChats: [], activeSideChatId: null }, ...s.chatSessions] })),
  updateChatSession: (id, updates) =>
    set(s => ({ chatSessions: s.chatSessions.map(c => c.id === id ? { ...c, ...updates } : c) })),
  setActiveChatId: (id) => set({ activeChatId: id }),

  addSideChat: (sessionId, model = 'minimax-m3:cloud') => {
    const id = uuidv4()
    set(s => ({
      chatSessions: s.chatSessions.map(sess =>
        sess.id === sessionId
          ? { ...sess, sideChats: [...(sess.sideChats || []), { id, model, messages: [] }], activeSideChatId: id }
          : sess
      )
    }))
  },
  updateSideChat: (sessionId, sideChatId, updates) =>
    set(s => ({
      chatSessions: s.chatSessions.map(sess =>
        sess.id === sessionId
          ? { ...sess, sideChats: sess.sideChats.map(sc => sc.id === sideChatId ? { ...sc, ...updates } : sc) }
          : sess
      )
    })),
  setActiveSideChatId: (sessionId, sideChatId) =>
    set(s => ({
      chatSessions: s.chatSessions.map(sess =>
        sess.id === sessionId ? { ...sess, activeSideChatId: sideChatId } : sess
      )
    })),
}))
