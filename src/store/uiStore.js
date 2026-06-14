import { create } from "zustand";
import { db } from "../lib/db";

// UI-only state (transient). Theme and other persisted settings live in
// `useSettingsStore`; this store only owns view state.
export const useUiStore = create((set, get) => ({
  sideChatOpen: false,
  ollamaConnected: false,
  availableModels: [],
  customModels: [],
  sideChatPrefill: null,
  settingsOpen: false,
  // Quota/auth message from the Ollama web search backend (null when none).
  webSearchNotice: null,

  setSideChatOpen: (open) => set({ sideChatOpen: open }),
  toggleSideChat: () => set((s) => ({ sideChatOpen: !s.sideChatOpen })),
  setSideChatPrefill: (text) => set({ sideChatPrefill: text }),
  clearSideChatPrefill: () => set({ sideChatPrefill: null }),

  setOllamaConnected: (v) => set({ ollamaConnected: v }),
  setAvailableModels: (models) =>
    set({ availableModels: models, ollamaConnected: true }),
  setCustomModels: (models) => set({ customModels: models }),
  addCustomModel: (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (get().customModels.includes(trimmed)) return;
    set((s) => ({ customModels: [...s.customModels, trimmed] }));
    db.addCustomModel(trimmed);
  },
  removeCustomModel: (name) => {
    set((s) => ({ customModels: s.customModels.filter((m) => m !== name) }));
    db.removeCustomModel(name);
  },

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  setWebSearchNotice: (msg) => set({ webSearchNotice: msg }),
  clearWebSearchNotice: () => set({ webSearchNotice: null }),
}));
