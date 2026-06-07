import { create } from "zustand";
import { applyTheme } from "../theme";

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
  theme: initialTheme,
  setSideChatOpen: (open) => set({ sideChatOpen: open }),
  toggleSideChat: () => set((s) => ({ sideChatOpen: !s.sideChatOpen })),
  setOllamaConnected: (v) => set({ ollamaConnected: v }),
  setAvailableModels: (models) => set({ availableModels: models, ollamaConnected: true }),

  setTheme: (name) => {
    applyTheme(name);
    try { localStorage.setItem(STORAGE_KEY, name); } catch {}
    set({ theme: name });
  },
  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    get().setTheme(next);
  },
}));
