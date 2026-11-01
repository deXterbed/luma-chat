import { create } from "zustand";
import { db } from "../lib/db";
import {
  checkForUpdate,
  installUpdate as downloadAndInstall,
} from "../lib/updater";

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

  updateCheck: { phase: "idle" },
  setUpdateCheck: (next) => set({ updateCheck: next }),

  // Driven by the macOS "Check for Updates…" menu item and by a silent check
  // on launch; the TitleBar renders the result. `phase` is one of idle |
  // checking | current | available | downloading | installing | error.
  //
  // `silent` skips the "checking" and "current" states and swallows errors, so
  // the automatic check only ever surfaces when there is something to install.
  checkForUpdates: async (opts) => {
    const silent = opts?.silent === true;
    if (silent && get().updateCheck.phase !== "idle") return;
    if (!silent) set({ updateCheck: { phase: "checking" } });
    try {
      const update = await checkForUpdate();
      if (update) set({ updateCheck: { phase: "available", update } });
      else if (!silent) set({ updateCheck: { phase: "current" } });
    } catch (err) {
      if (!silent) {
        set({ updateCheck: { phase: "error", text: String(err) } });
      }
    }
  },
  installUpdate: async () => {
    const { updateCheck } = get();
    if (updateCheck.phase !== "available") return;
    set({ updateCheck: { phase: "downloading", percent: null } });
    try {
      await downloadAndInstall(updateCheck.update, ({ phase, percent }) =>
        set({ updateCheck: { phase, percent } }),
      );
    } catch (err) {
      set({ updateCheck: { phase: "error", text: String(err) } });
    }
  },

  setWebSearchNotice: (msg) => set({ webSearchNotice: msg }),
  clearWebSearchNotice: () => set({ webSearchNotice: null }),
}));
