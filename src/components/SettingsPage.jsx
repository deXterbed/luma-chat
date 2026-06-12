import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, RotateCcw, ChevronDown, Check } from "lucide-react";
import { useUiStore } from "../store/uiStore";
import { useSettingsStore, SETTINGS_DEFAULTS } from "../store/settingsStore";
import styles from "./SettingsPage.module.css";

// Minimal settings page (scope A). Three sections: appearance, default model,
// default web search. All values persist to the `settings` SQLite table via
// `useSettingsStore`; no localStorage is used (per project rule).
export default function SettingsPage() {
  const closeSettings = useUiStore((s) => s.closeSettings);
  const availableModels = useUiStore((s) => s.availableModels);
  const customModels = useUiStore((s) => s.customModels);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const setDefaultModel = useSettingsStore((s) => s.setDefaultModel);
  const webSearchDefault = useSettingsStore((s) => s.webSearchDefault);
  const setWebSearchDefault = useSettingsStore((s) => s.setWebSearchDefault);
  const thinkingDefault = useSettingsStore((s) => s.thinkingDefault);
  const setThinkingDefault = useSettingsStore((s) => s.setThinkingDefault);
  const resetToDefaults = useSettingsStore((s) => s.resetToDefaults);

  // Model picker state
  const [modelOpen, setModelOpen] = useState(false);
  const [modelSaved, setModelSaved] = useState(false);
  const modelRootRef = useRef(null);

  // Merged, deduped, alphabetically sorted list of model names. Only models
  // the user has access to (pulled locally or saved as a custom alias) are
  // shown — no free-form text fallback.
  const modelOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const m of availableModels) {
      if (seen.has(m)) continue;
      seen.add(m);
      out.push(m);
    }
    for (const m of customModels) {
      if (seen.has(m)) continue;
      seen.add(m);
      out.push(m);
    }
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }, [availableModels, customModels]);

  // Outside click closes the dropdown.
  useEffect(() => {
    if (!modelOpen) return;
    const onDown = (e) => {
      if (modelRootRef.current && !modelRootRef.current.contains(e.target)) {
        setModelOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [modelOpen]);

  // Esc closes the page, or the dropdown first if it's open.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (modelOpen) {
        setModelOpen(false);
        return;
      }
      closeSettings();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeSettings, modelOpen]);

  const pickModel = (name) => {
    setDefaultModel(name);
    setModelOpen(false);
    setModelSaved(true);
    setTimeout(() => setModelSaved(false), 1200);
  };

  const handleReset = () => {
    if (
      !window.confirm(
        "Reset all settings to their defaults? This won't touch your chats.",
      )
    )
      return;
    resetToDefaults();
    setModelOpen(false);
  };

  // Saved tick: shown briefly after a successful pick. The trigger always
  // reflects the saved default, so we don't need a persistent tick state.
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button
          onClick={closeSettings}
          className={styles.backBtn}
          aria-label="Back to chat"
        >
          <ArrowLeft size={13} />
          Back
        </button>
        <h1 className={styles.title}>Settings</h1>
        <div className={styles.spacer} />
      </div>

      <div className={styles.body}>
        {/* ── Appearance ── */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Appearance</h2>
            <p className={styles.sectionHint}>
              Choose how Luma looks. Changes apply immediately.
            </p>
          </div>

          <div
            className={styles.segmented}
            role="radiogroup"
            aria-label="Theme"
          >
            <button
              role="radio"
              aria-checked={theme === "dark"}
              onClick={() => setTheme("dark")}
              className={`${styles.segBtn} ${theme === "dark" ? styles.segBtnActive : ""}`}
            >
              Dark
            </button>
            <button
              role="radio"
              aria-checked={theme === "light"}
              onClick={() => setTheme("light")}
              className={`${styles.segBtn} ${theme === "light" ? styles.segBtnActive : ""}`}
            >
              Light
            </button>
          </div>
        </section>

        {/* ── Default model ── */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Default model</h2>
            <p className={styles.sectionHint}>
              The model new chats and side chats start with. Existing chats keep
              the model you picked for them.
            </p>
          </div>

          <div className={styles.modelRow} ref={modelRootRef}>
            <button
              type="button"
              onClick={() => setModelOpen((v) => !v)}
              className={styles.modelTrigger}
              aria-haspopup="listbox"
              aria-expanded={modelOpen}
              disabled={modelOptions.length === 0}
            >
              <span className={styles.modelTriggerText}>
                {defaultModel || "No models available"}
              </span>
              <ChevronDown size={11} />
            </button>

            {modelSaved && !modelOpen ? (
              <span
                className={styles.savedTick}
                aria-live="polite"
                title="Saved"
              >
                <Check size={12} />
              </span>
            ) : null}

            {modelOpen && (
              <div className={styles.modelDropdown} role="listbox">
                <div className={styles.modelDropdownHeader}>
                  <span>
                    {`${modelOptions.length} model${modelOptions.length === 1 ? "" : "s"}`}
                  </span>
                </div>

                <div className={styles.modelList}>
                  {modelOptions.map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="option"
                      aria-selected={m === defaultModel}
                      onClick={() => pickModel(m)}
                      className={`${styles.modelOption} ${m === defaultModel ? styles.modelOptionActive : ""}`}
                    >
                      <span className={styles.modelOptionText}>{m}</span>
                      {m === defaultModel ? (
                        <Check size={11} className={styles.modelOptionCheck} />
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Web search default ── */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Web search default</h2>
            <p className={styles.sectionHint}>
              Whether the per-pane "web" toggle starts on or off. You can still
              flip it per-pane at any time — that override doesn't persist.
            </p>
          </div>

          <label className={styles.toggleRow}>
            <span className={styles.toggleLabel}>
              Enable web search in new chats
            </span>
            <button
              role="switch"
              aria-checked={webSearchDefault}
              onClick={() => setWebSearchDefault(!webSearchDefault)}
              className={`${styles.switch} ${webSearchDefault ? styles.switchOn : ""}`}
            >
              <span className={styles.switchKnob} />
            </button>
          </label>
        </section>

        {/* ── Thinking mode ── */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Thinking mode</h2>
            <p className={styles.sectionHint}>
              Models like Qwen3 reason internally before responding. Disable to
              skip the reasoning step and get faster replies.
            </p>
          </div>

          <label className={styles.toggleRow}>
            <span className={styles.toggleLabel}>Enable thinking mode</span>
            <button
              role="switch"
              aria-checked={thinkingDefault}
              onClick={() => setThinkingDefault(!thinkingDefault)}
              className={`${styles.switch} ${thinkingDefault ? styles.switchOn : ""}`}
            >
              <span className={styles.switchKnob} />
            </button>
          </label>
        </section>

        {/* ── Reset ── */}
        <div className={styles.resetRow}>
          <button onClick={handleReset} className={styles.resetBtn}>
            <RotateCcw size={11} />
            Reset to defaults
          </button>
        </div>
      </div>
    </div>
  );
}
