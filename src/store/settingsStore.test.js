import { useSettingsStore, SETTING_KEYS } from "./settingsStore";
import { db } from "../lib/db";
import { applyTheme } from "../theme";

// Mock the DB layer — settings store talks to it on every set, and the
// `hydrate` flow is the most interesting thing under test.
vi.mock("../lib/db", () => ({
  db: {
    loadSettings: vi.fn().mockResolvedValue({}),
    saveSetting: vi.fn().mockResolvedValue(undefined),
  },
}));

// Spy on `applyTheme` so we can assert the DOM side effect without actually
// poking the document (jsdom would work too, but this is more direct).
vi.mock("../theme", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, applyTheme: vi.fn() };
});

// jsdom doesn't ship with a working `localStorage` by default. The
// settings store reads a legacy `luma:theme` key for one-time migration
// from pre-settings-page builds, so we provide a minimal in-memory
// shim that the migration tests can poke.
const _localStore = new Map();
const _localStorageStub = {
  getItem: (k) => (_localStore.has(k) ? _localStore.get(k) : null),
  setItem: (k, v) => _localStore.set(k, String(v)),
  removeItem: (k) => _localStore.delete(k),
  clear: () => _localStore.clear(),
  key: (i) => Array.from(_localStore.keys())[i] ?? null,
  get length() {
    return _localStore.size;
  },
};
Object.defineProperty(window, "localStorage", {
  value: _localStorageStub,
  writable: true,
  configurable: true,
});

describe("settingsStore", () => {
  let store;

  beforeEach(() => {
    store = useSettingsStore;
    // Hard reset between tests. Don't rely on `setState` here because the
    // store's actions write to `db` — we want a clean mock call list too.
    db.loadSettings.mockReset().mockResolvedValue({});
    db.saveSetting.mockReset().mockResolvedValue(undefined);
    applyTheme.mockClear();
    store.setState({
      hydrated: false,
      theme: "dark",
      defaultModel: "minimax-m3:cloud",
      webSearchDefault: false,
    });
    // Clear the legacy localStorage hint so migration tests are isolated.
    if (window.localStorage) window.localStorage.removeItem("luma:theme");
  });

  describe("initial state", () => {
    it("starts with hydrated=false", () => {
      expect(store.getState().hydrated).toBe(false);
    });

    it("has a hardcoded default theme", () => {
      // Whatever the OS preference is, the store must start with a
      // concrete value — never null/undefined.
      expect(["dark", "light"]).toContain(store.getState().theme);
    });

    it("has a hardcoded default model", () => {
      expect(store.getState().defaultModel).toBe("minimax-m3:cloud");
    });

    it("has web search default off", () => {
      expect(store.getState().webSearchDefault).toBe(false);
    });
  });

  describe("setTheme", () => {
    it("accepts 'dark' and 'light'", () => {
      store.getState().setTheme("dark");
      expect(store.getState().theme).toBe("dark");
      store.getState().setTheme("light");
      expect(store.getState().theme).toBe("light");
    });

    it("ignores invalid values", () => {
      store.getState().setTheme("neon");
      expect(store.getState().theme).toBe("dark");
      store.getState().setTheme(undefined);
      expect(store.getState().theme).toBe("dark");
    });

    it("calls applyTheme for the new value", () => {
      applyTheme.mockClear();
      store.getState().setTheme("light");
      expect(applyTheme).toHaveBeenCalledWith("light");
    });

    it("persists to SQLite", () => {
      store.getState().setTheme("light");
      expect(db.saveSetting).toHaveBeenCalledWith(SETTING_KEYS.theme, "light");
    });
  });

  describe("toggleTheme", () => {
    it("flips dark to light", () => {
      store.setState({ theme: "dark" });
      store.getState().toggleTheme();
      expect(store.getState().theme).toBe("light");
    });

    it("flips light to dark", () => {
      store.setState({ theme: "light" });
      store.getState().toggleTheme();
      expect(store.getState().theme).toBe("dark");
    });
  });

  describe("setDefaultModel", () => {
    it("trims whitespace and persists", () => {
      store.getState().setDefaultModel("  llama3.1:8b  ");
      expect(store.getState().defaultModel).toBe("llama3.1:8b");
      expect(db.saveSetting).toHaveBeenCalledWith(
        SETTING_KEYS.defaultModel,
        "llama3.1:8b",
      );
    });

    it("rejects empty / whitespace-only input", () => {
      store.setState({ defaultModel: "previous" });
      store.getState().setDefaultModel("   ");
      expect(store.getState().defaultModel).toBe("previous");
      expect(db.saveSetting).not.toHaveBeenCalled();
    });

    it("rejects null/undefined", () => {
      store.setState({ defaultModel: "previous" });
      store.getState().setDefaultModel(null);
      expect(store.getState().defaultModel).toBe("previous");
    });
  });

  describe("setWebSearchDefault", () => {
    it("turns on and persists 'true'", () => {
      store.getState().setWebSearchDefault(true);
      expect(store.getState().webSearchDefault).toBe(true);
      expect(db.saveSetting).toHaveBeenCalledWith(
        SETTING_KEYS.webSearchDefault,
        "true",
      );
    });

    it("turns off and persists 'false'", () => {
      store.setState({ webSearchDefault: true });
      store.getState().setWebSearchDefault(false);
      expect(store.getState().webSearchDefault).toBe(false);
      expect(db.saveSetting).toHaveBeenCalledWith(
        SETTING_KEYS.webSearchDefault,
        "false",
      );
    });

    it("coerces truthy/falsy values", () => {
      store.getState().setWebSearchDefault("yes");
      expect(store.getState().webSearchDefault).toBe(true);
      store.getState().setWebSearchDefault(0);
      expect(store.getState().webSearchDefault).toBe(false);
    });
  });

  describe("resetToDefaults", () => {
    it("restores every key and persists each one", () => {
      // Mess up every setting first.
      store.setState({
        theme: "light",
        defaultModel: "weird-model",
        webSearchDefault: true,
      });
      applyTheme.mockClear();
      db.saveSetting.mockClear();

      store.getState().resetToDefaults();

      expect(store.getState().theme).toBe("dark");
      expect(store.getState().defaultModel).toBe("minimax-m3:cloud");
      expect(store.getState().webSearchDefault).toBe(false);
      expect(applyTheme).toHaveBeenCalledWith("dark");
      expect(db.saveSetting).toHaveBeenCalledWith(SETTING_KEYS.theme, "dark");
      expect(db.saveSetting).toHaveBeenCalledWith(
        SETTING_KEYS.defaultModel,
        "minimax-m3:cloud",
      );
      expect(db.saveSetting).toHaveBeenCalledWith(
        SETTING_KEYS.webSearchDefault,
        "false",
      );
    });
  });

  describe("hydrate", () => {
    it("reads from db.loadSettings and flips hydrated", async () => {
      db.loadSettings.mockResolvedValue({
        [SETTING_KEYS.theme]: "light",
        [SETTING_KEYS.defaultModel]: "qwen2.5:7b",
        [SETTING_KEYS.webSearchDefault]: "true",
      });

      await store.getState().hydrate();

      expect(store.getState().theme).toBe("light");
      expect(store.getState().defaultModel).toBe("qwen2.5:7b");
      expect(store.getState().webSearchDefault).toBe(true);
      expect(store.getState().hydrated).toBe(true);
      expect(applyTheme).toHaveBeenCalledWith("light");
    });

    it("falls back to defaults when DB returns empty", async () => {
      db.loadSettings.mockResolvedValue({});

      await store.getState().hydrate();

      expect(store.getState().theme).toBe("dark");
      expect(store.getState().defaultModel).toBe("minimax-m3:cloud");
      expect(store.getState().webSearchDefault).toBe(false);
      expect(store.getState().hydrated).toBe(true);
    });

    it("ignores invalid theme values and keeps the default", async () => {
      db.loadSettings.mockResolvedValue({ [SETTING_KEYS.theme]: "neon" });

      await store.getState().hydrate();

      expect(store.getState().theme).toBe("dark");
    });

    it("ignores empty/non-string defaultModel and keeps the default", async () => {
      db.loadSettings.mockResolvedValue({
        [SETTING_KEYS.defaultModel]: "   ",
      });

      await store.getState().hydrate();

      expect(store.getState().defaultModel).toBe("minimax-m3:cloud");
    });

    it("treats webSearchDefault as off unless literally 'true'", async () => {
      db.loadSettings.mockResolvedValue({
        [SETTING_KEYS.webSearchDefault]: "1",
      });
      await store.getState().hydrate();
      expect(store.getState().webSearchDefault).toBe(false);

      db.loadSettings.mockResolvedValue({
        [SETTING_KEYS.webSearchDefault]: "true",
      });
      await store.getState().hydrate();
      expect(store.getState().webSearchDefault).toBe(true);
    });

    it("migrates a legacy localStorage theme into SQLite on first run", async () => {
      // Simulate a pre-settings build: DB has nothing, but legacy
      // localStorage has the user's old theme choice.
      db.loadSettings.mockResolvedValue({});
      window.localStorage.setItem("luma:theme", "light");

      await store.getState().hydrate();

      expect(store.getState().theme).toBe("light");
      expect(applyTheme).toHaveBeenCalledWith("light");
      // The migration writes the legacy value to SQLite so we can drop
      // the localStorage fallback in a future release.
      expect(db.saveSetting).toHaveBeenCalledWith(SETTING_KEYS.theme, "light");
    });

    it("does NOT migrate when SQLite already has a theme", async () => {
      // If SQLite has the authoritative value, the localStorage hint is
      // ignored — prevents stale data from clobbering newer state.
      db.loadSettings.mockResolvedValue({ [SETTING_KEYS.theme]: "dark" });
      window.localStorage.setItem("luma:theme", "light");

      await store.getState().hydrate();

      expect(store.getState().theme).toBe("dark");
      // No `saveSetting` for theme — we didn't migrate.
      expect(db.saveSetting).not.toHaveBeenCalledWith(
        SETTING_KEYS.theme,
        "light",
      );
    });

    it("ignores a garbage localStorage value", async () => {
      db.loadSettings.mockResolvedValue({});
      window.localStorage.setItem("luma:theme", "magenta");

      await store.getState().hydrate();

      expect(store.getState().theme).toBe("dark");
      expect(db.saveSetting).not.toHaveBeenCalled();
    });

    it("propagates db.loadSettings errors (caller catches)", async () => {
      // The store doesn't swallow DB errors — `useDbInit` wraps the
      // call in try/catch and falls back to in-memory defaults. This
      // contract (rethrow) is worth pinning down.
      db.loadSettings.mockRejectedValue(new Error("sqlite broken"));

      await expect(store.getState().hydrate()).rejects.toThrow("sqlite broken");
      // The store stays pre-hydration; the catch in useDbInit is what
      // keeps the app usable.
      expect(store.getState().hydrated).toBe(false);
    });
  });
});
