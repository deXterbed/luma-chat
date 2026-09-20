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
  searchProvider: "searchProvider",
  ollamaApiKey: "ollamaApiKey",
  ollamaUrl: "ollamaUrl",
  numCtx: "numCtx",
  temperature: "temperature",
  // Set once the user has seen the "your project files go to the model's
  // server" notice, so it doesn't reappear on every attach.
  projectRemoteNoticeAck: "projectRemoteNoticeAck",
  // Opt-in structured log of the agent loop (tool calls, policy decisions,
  // failures) for tuning the harness. Off by default: it records file contents.
  agentLogEnabled: "agentLogEnabled",
};

// Web search backends. "duckduckgo" scrapes DDG locally (no key); "ollama"
// uses the key-gated Ollama cloud web search API.
export const SEARCH_PROVIDERS = ["duckduckgo", "ollama"];

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
  searchProvider: "duckduckgo",
  ollamaApiKey: "",
  ollamaUrl: "",
  // Ollama request options. 8192 is Ollama's own default but far too small to
  // hold a source file; Codebase mode wants 32768 or more.
  numCtx: 8192,
  temperature: 0.7,
  projectRemoteNoticeAck: false,
  agentLogEnabled: false,
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
  searchProvider: DEFAULTS.searchProvider,
  ollamaApiKey: DEFAULTS.ollamaApiKey,
  ollamaUrl: DEFAULTS.ollamaUrl,
  numCtx: DEFAULTS.numCtx,
  temperature: DEFAULTS.temperature,
  projectRemoteNoticeAck: DEFAULTS.projectRemoteNoticeAck,
  agentLogEnabled: DEFAULTS.agentLogEnabled,

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
      numCtx: parseNumCtx(stored[SETTING_KEYS.numCtx]),
      temperature: parseTemperature(stored[SETTING_KEYS.temperature]),
      projectRemoteNoticeAck: stored[SETTING_KEYS.projectRemoteNoticeAck] === "true",
      agentLogEnabled: stored[SETTING_KEYS.agentLogEnabled] === "true",
      searchProvider: SEARCH_PROVIDERS.includes(stored[SETTING_KEYS.searchProvider])
        ? stored[SETTING_KEYS.searchProvider]
        : DEFAULTS.searchProvider,
      ollamaApiKey:
        typeof stored[SETTING_KEYS.ollamaApiKey] === "string"
          ? stored[SETTING_KEYS.ollamaApiKey]
          : DEFAULTS.ollamaApiKey,
      ollamaUrl:
        typeof stored[SETTING_KEYS.ollamaUrl] === "string"
          ? stored[SETTING_KEYS.ollamaUrl]
          : DEFAULTS.ollamaUrl,
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

  setSearchProvider: (provider) => {
    const v = SEARCH_PROVIDERS.includes(provider)
      ? provider
      : DEFAULTS.searchProvider;
    set({ searchProvider: v });
    db.saveSetting(SETTING_KEYS.searchProvider, v);
  },

  setOllamaApiKey: (key) => {
    const v = (key || "").trim();
    set({ ollamaApiKey: v });
    db.saveSetting(SETTING_KEYS.ollamaApiKey, v);
  },

  setOllamaUrl: (url) => {
    const v = (url || "").trim();
    set({ ollamaUrl: v });
    db.saveSetting(SETTING_KEYS.ollamaUrl, v);
  },

  setNumCtx: (n) => {
    const v = parseNumCtx(n);
    set({ numCtx: v });
    db.saveSetting(SETTING_KEYS.numCtx, String(v));
  },

  setTemperature: (t) => {
    const v = parseTemperature(t);
    set({ temperature: v });
    db.saveSetting(SETTING_KEYS.temperature, String(v));
  },

  ackProjectRemoteNotice: () => {
    set({ projectRemoteNoticeAck: true });
    db.saveSetting(SETTING_KEYS.projectRemoteNoticeAck, "true");
  },

  setAgentLogEnabled: (enabled) => {
    const v = !!enabled;
    set({ agentLogEnabled: v });
    db.saveSetting(SETTING_KEYS.agentLogEnabled, v ? "true" : "false");
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
      searchProvider: DEFAULTS.searchProvider,
      ollamaApiKey: DEFAULTS.ollamaApiKey,
      ollamaUrl: DEFAULTS.ollamaUrl,
      numCtx: DEFAULTS.numCtx,
      temperature: DEFAULTS.temperature,
    });
    db.saveSetting(SETTING_KEYS.theme, DEFAULTS.theme);
    db.saveSetting(SETTING_KEYS.defaultModel, DEFAULTS.defaultModel);
    db.saveSetting(
      SETTING_KEYS.webSearchDefault,
      DEFAULTS.webSearchDefault ? "true" : "false",
    );
    db.saveSetting(SETTING_KEYS.toolCallLimit, String(DEFAULTS.toolCallLimit));
    db.saveSetting(SETTING_KEYS.searchProvider, DEFAULTS.searchProvider);
    db.saveSetting(SETTING_KEYS.ollamaApiKey, DEFAULTS.ollamaApiKey);
    db.saveSetting(SETTING_KEYS.ollamaUrl, DEFAULTS.ollamaUrl);
  },
}));

// Parse a stored/user-supplied tool-call limit into a non-negative integer.
// Anything invalid falls back to 0 (unlimited).
function parseToolCallLimit(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULTS.toolCallLimit;
}

// Context window, in tokens. Clamped to a sane range: below 2048 nothing
// useful fits, and beyond 131072 Ollama would reject or thrash.
function parseNumCtx(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULTS.numCtx;
  return Math.min(131072, Math.max(2048, n));
}

function parseTemperature(raw) {
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return DEFAULTS.temperature;
  return Math.min(2, Math.max(0, n));
}

export const SETTINGS_DEFAULTS = DEFAULTS;
