import { create } from "zustand";
import { applyTheme } from "../theme";
import { db } from "../lib/db";

// Well-known setting keys. The Rust side stores these as strings in
// a key/value table; the renderer is the source of truth for what
// keys exist and how to parse them.
export const SETTING_KEYS = {
  theme: "theme",
  defaultModel: "defaultModel",
  webSearchDefault: "webSearchDefault",
  toolCallLimit: "toolCallLimit",
};

// Hardcoded fallbacks used when the DB has no value yet (first launch).
// Theme prefers the OS preference (handled in `readInitialTheme`),
// matches the previous localStorage behaviour.
function readInitialTheme() {
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: light)").matches
  ) {
    return "light";
  }
  return "dark";
}

const DEFAULTS = {
  theme: readInitialTheme(),
  defaultModel: "minimax-m3:cloud",
  webSearchDefault: false,
  // Max tool-calling rounds before the model must give a final answer.
  // 0 = unlimited (no cap).
  toolCallLimit: 0,
};

export const useSettingsStore = create((set, get) => ({
  // Hydration flag — true once we've loaded (or attempted to load) from
  // the DB. Components that depend on persisted settings should wait
  // for this so they don't render with the wrong default.
  hydrated: false,
  theme: DEFAULTS.theme,
  defaultModel: DEFAULTS.defaultModel,
  webSearchDefault: DEFAULTS.webSearchDefault,
  toolCallLimit: DEFAULTS.toolCallLimit,

  // Called from useDbInit. Loads from DB and applies the theme to <html>.
  // Unknown keys are ignored; missing keys keep their default. On the very
  // first migration from a pre-Settings-page build, the theme may still
  // live in `localStorage['luma:theme']`; if so, pick it up and persist
  // it to SQLite so we can delete the localStorage fallback later.
  hydrate: async () => {
    const stored = (await db.loadSettings()) || {};

    // One-time theme migration from localStorage.
    let theme =
      stored[SETTING_KEYS.theme] === "light" ||
      stored[SETTING_KEYS.theme] === "dark"
        ? stored[SETTING_KEYS.theme]
        : DEFAULTS.theme;
    if (!(SETTING_KEYS.theme in stored) && typeof window !== "undefined") {
      try {
        const legacy = window.localStorage?.getItem("luma:theme");
        if (legacy === "light" || legacy === "dark") {
          theme = legacy;
          db.saveSetting(SETTING_KEYS.theme, legacy);
        }
      } catch {
        // localStorage can throw in private-browsing mode; ignore.
      }
    }

    const next = {
      theme,
      defaultModel:
        typeof stored[SETTING_KEYS.defaultModel] === "string" &&
        stored[SETTING_KEYS.defaultModel].trim().length > 0
          ? stored[SETTING_KEYS.defaultModel]
          : DEFAULTS.defaultModel,
      webSearchDefault: stored[SETTING_KEYS.webSearchDefault] === "true",
      toolCallLimit: parseToolCallLimit(stored[SETTING_KEYS.toolCallLimit]),
    };
    applyTheme(next.theme);
    set({ ...next, hydrated: true });
  },

  setTheme: (name) => {
    if (name !== "dark" && name !== "light") return;
    applyTheme(name);
    set({ theme: name });
    db.saveSetting(SETTING_KEYS.theme, name);
  },

  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    get().setTheme(next);
  },

  setDefaultModel: (name) => {
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    set({ defaultModel: trimmed });
    db.saveSetting(SETTING_KEYS.defaultModel, trimmed);
  },

  setWebSearchDefault: (enabled) => {
    set({ webSearchDefault: !!enabled });
    db.saveSetting(SETTING_KEYS.webSearchDefault, enabled ? "true" : "false");
  },

  setToolCallLimit: (n) => {
    const v = parseToolCallLimit(n);
    set({ toolCallLimit: v });
    db.saveSetting(SETTING_KEYS.toolCallLimit, String(v));
  },

  // Reset every well-known key back to its hardcoded default and persist.
  // Used by the settings page's "Reset to defaults" link.
  resetToDefaults: () => {
    applyTheme(DEFAULTS.theme);
    set({
      theme: DEFAULTS.theme,
      defaultModel: DEFAULTS.defaultModel,
      webSearchDefault: DEFAULTS.webSearchDefault,
      toolCallLimit: DEFAULTS.toolCallLimit,
    });
    db.saveSetting(SETTING_KEYS.theme, DEFAULTS.theme);
    db.saveSetting(SETTING_KEYS.defaultModel, DEFAULTS.defaultModel);
    db.saveSetting(
      SETTING_KEYS.webSearchDefault,
      DEFAULTS.webSearchDefault ? "true" : "false",
    );
    db.saveSetting(SETTING_KEYS.toolCallLimit, String(DEFAULTS.toolCallLimit));
  },
}));

// Parse a stored/user-supplied tool-call limit into a non-negative integer.
// Anything invalid falls back to 0 (unlimited).
function parseToolCallLimit(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULTS.toolCallLimit;
}

export const SETTINGS_DEFAULTS = DEFAULTS;
