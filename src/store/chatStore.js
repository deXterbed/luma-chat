import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'

// Factory to create an independent chat store
// Both main chat and side chat use this same factory — fully isolated state
export const createChatStore = (id) => create((set, get) => ({
  id,
  model: 'minimax-m3:cloud',
  messages: [],         // { id, role, content, images?, isStreaming? }
  isStreaming: false,
  abortController: null,
  error: null,

  setModel: (model) => set({ model }),

  addMessage: (role, content, images = []) => {
    const msg = { id: uuidv4(), role, content, images, isStreaming: false }
    set(s => ({ messages: [...s.messages, msg] }))
    return msg.id
  },

  addStreamingMessage: () => {
    const id = uuidv4()
    const msg = { id, role: 'assistant', content: '', isStreaming: true }
    set(s => ({ messages: [...s.messages, msg], isStreaming: true }))
    return id
  },

  updateStreamingMessage: (id, content) => {
    set(s => ({
      messages: s.messages.map(m => m.id === id ? { ...m, content } : m)
    }))
  },

  finalizeMessage: (id, content) => {
    set(s => ({
      messages: s.messages.map(m =>
        m.id === id ? { ...m, content, isStreaming: false } : m
      ),
      isStreaming: false,
      abortController: null,
    }))
  },

  setError: (error) => set({ error, isStreaming: false }),
  clearError: () => set({ error: null }),

  setAbortController: (ctrl) => set({ abortController: ctrl }),

  stopStreaming: () => {
    const { abortController } = get()
    if (abortController) abortController.abort()
    set(s => ({
      isStreaming: false,
      abortController: null,
      messages: s.messages.map(m =>
        m.isStreaming ? { ...m, isStreaming: false } : m
      )
    }))
  },

  clearMessages: () => set({ messages: [], error: null }),

  loadMessages: (messages, model) => set({ messages, model, error: null, isStreaming: false, abortController: null }),

  // Build messages array for Ollama API (includes image data)
  getApiMessages: () => {
    return get().messages
      .filter(m => !m.isStreaming || m.content)
      .map(m => {
        const msg = { role: m.role, content: m.content }
        if (m.images && m.images.length > 0) {
          msg.images = m.images
        }
        return msg
      })
  },
}))

// Singleton stores — one for each pane
export const useMainChat = createChatStore('main')
export const useSideChat = createChatStore('side')

// Global app store (sidebar, panel visibility, model list)
export const useAppStore = create((set) => ({
  sideChatOpen: false,
  availableModels: [],
  ollamaConnected: false,

  // Chat history (sidebar list)
  chatSessions: [],
  activeChatId: null,

  setSideChatOpen: (open) => set({ sideChatOpen: open }),
  toggleSideChat: () => set(s => ({ sideChatOpen: !s.sideChatOpen })),

  setAvailableModels: (models) => set({ models, ollamaConnected: true }),
  setOllamaConnected: (v) => set({ ollamaConnected: v }),

  addChatSession: (session) =>
    set(s => ({ chatSessions: [session, ...s.chatSessions] })),
  updateChatSession: (id, updates) =>
    set(s => ({ chatSessions: s.chatSessions.map(c => c.id === id ? { ...c, ...updates } : c) })),
  setActiveChatId: (id) => set({ activeChatId: id }),
}))
