// Model facts the harness needs at run time, and the rule that uses them.
//
// Two separate questions, deliberately using two different signals:
//
//   - **Whose memory is this?** — the `cloud` tag suffix. Context on a cloud
//     model is ollama.com's hardware; on a local model it's the user's VRAM,
//     where a big `num_ctx` means a huge KV cache, layers pushed to CPU, or a
//     model that won't load. So only cloud models may be silently raised.
//     The tag is the only signal available: cloud requests are proxied through
//     the local Ollama daemon, so `ollamaUrl` is loopback either way.
//
//   - **How big can it actually be?** — the model's own window, from Ollama's
//     `/api/show` (`gemma4.context_length` = 262144 for `gemma4:31b-cloud`).
//     This is the ceiling, and it has to be the model's real number: asking for
//     more than the trained length doesn't error, it silently degrades output
//     through RoPE scaling.

import { useSettingsStore } from "../store/settingsStore";

/** Ollama cloud models carry a `cloud` tag suffix (`gemma4:31b-cloud`). */
export function isCloudModel(model) {
  return /(?::|-)cloud$/.test(model || "");
}

/**
 * Codebase mode's ceiling for `num_ctx`: room for a few large reads plus the
 * transcript, without paying attention cost the model will never use. A single
 * max-size read is ~40k tokens, so this is roughly two of those plus history.
 */
export const CODEBASE_MAX_CTX = 65536;

const FALLBACK_CTX = 8192;

/** model -> window. Successes only; see `loadModelWindow`. */
const windows = new Map();
/** In-flight lookups, so two panes asking at once share one request. */
const inFlight = new Map();

/**
 * The window if we already know it — read synchronously when a run starts, so a
 * send is never blocked on Ollama.
 */
export function cachedModelWindow(model) {
  return windows.get(model);
}

/**
 * Look up and remember a model's window. Resolves to the window or `null`.
 *
 * A failure isn't cached: Ollama being down, or a model that isn't pulled yet,
 * shouldn't disable this for the rest of the session — the next warm-up retries.
 */
export function loadModelWindow(model) {
  if (!model) return Promise.resolve(null);
  if (windows.has(model)) return Promise.resolve(windows.get(model));
  const pending = inFlight.get(model);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const { ollamaUrl, ollamaApiKey } = useSettingsStore.getState();
      const value = await invoke("ollama_model_context", {
        model,
        ollamaUrl: ollamaUrl || null,
        apiKey: ollamaApiKey || null,
      });
      const window = Number.isFinite(value) && value > 0 ? value : null;
      if (window) windows.set(model, window);
      return window;
    } catch {
      return null;
    } finally {
      inFlight.delete(model);
    }
  })();

  inFlight.set(model, promise);
  return promise;
}

/**
 * The `num_ctx` a run actually sends.
 *
 * Chat mode uses the setting as-is. Codebase mode raises it — holding a few
 * source files needs more than 8192 — but only for a cloud model (not the
 * user's memory) and never past the model's own window (so quality can't quietly
 * degrade). It only ever *raises*: a setting already bigger than the window is
 * the user's explicit choice and is left alone, as is one on a local model.
 *
 * An unknown window means no raise, which is why a run logs the value it
 * resolved alongside the window it used.
 */
export function resolveNumCtx({ codebase, model, setting, modelWindow }) {
  const base = Number.isFinite(setting) && setting > 0 ? setting : FALLBACK_CTX;
  if (!codebase || !isCloudModel(model)) return base;
  if (!Number.isFinite(modelWindow) || modelWindow <= 0) return base;
  return Math.max(base, Math.min(modelWindow, CODEBASE_MAX_CTX));
}

/**
 * Whether the selected model has vanished from the server — renamed, retired, or
 * never pulled. Tags get dated (`deepseek-v4-flash:0731-cloud`) and providers
 * retire them, which leaves saved sessions pointing at something that can only
 * fail.
 *
 * Deliberately *warns* rather than correcting: `custom_models` holds tags that
 * aren't in `/api/tags` on purpose (cloud tags live there), so absence from the
 * list isn't proof of removal, and guessing a replacement would be the app
 * inventing intent. Quiet unless it actually knows — offline says nothing about
 * the model, and an unrefreshed list says nothing at all.
 */
export function isModelUnavailable({ model, available, custom, connected }) {
  if (!model || !connected) return false;
  if (!available?.length) return false;
  return !available.includes(model) && !custom?.includes(model);
}
