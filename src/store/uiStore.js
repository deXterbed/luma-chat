import { create } from "zustand";
import { applyTheme } from "../theme";
import { db } from "../lib/db";

const STORAGE_KEY = "luma:theme";

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {}
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: light)").matches
  ) {
    return "light";
  }
  return "dark";
}

const initialTheme = readStoredTheme();
applyTheme(initialTheme);

export const useUiStore = create((set, get) => ({
  sideChatOpen: false,
  ollamaConnected: false,
  availableModels: [],
  customModels: [],
  theme: initialTheme,
  sideChatPrefill: null,
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

  setTheme: (name) => {
    applyTheme(name);
    try {
      localStorage.setItem(STORAGE_KEY, name);
    } catch {}
    set({ theme: name });
  },
  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    get().setTheme(next);
  },
}));
