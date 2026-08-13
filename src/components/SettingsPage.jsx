import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, RotateCcw, ChevronDown, Check, Download, Upload } from "lucide-react";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { useUiStore } from "../store/uiStore";
import { useSettingsStore, SETTINGS_DEFAULTS } from "../store/settingsStore";
import { useSessionStore } from "../store/sessionStore";
import { db } from "../lib/db";
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
  const searchProvider = useSettingsStore((s) => s.searchProvider);
  const setSearchProvider = useSettingsStore((s) => s.setSearchProvider);
  const ollamaApiKey = useSettingsStore((s) => s.ollamaApiKey);
  const setOllamaApiKey = useSettingsStore((s) => s.setOllamaApiKey);
  const ollamaUrl = useSettingsStore((s) => s.ollamaUrl);
  const setOllamaUrl = useSettingsStore((s) => s.setOllamaUrl);
  const toolCallLimit = useSettingsStore((s) => s.toolCallLimit);
  const setToolCallLimit = useSettingsStore((s) => s.setToolCallLimit);
  const resetToDefaults = useSettingsStore((s) => s.resetToDefaults);
  const setSessionsFromDb = useSessionStore((s) => s.setSessionsFromDb);

  // Backup / restore
  const [backupStatus, setBackupStatus] = useState(null); // { kind: "success" | "error", text }
  const [backupBusy, setBackupBusy] = useState(false);

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

  const handleExport = async () => {
    setBackupStatus(null);
    setBackupBusy(true);
    try {
      const path = await saveDialog({
        title: "Export chats",
        defaultPath: `luma-chats-${new Date().toISOString().slice(0, 10)}.lumabackup`,
        filters: [{ name: "Luma backup", extensions: ["lumabackup"] }],
      });
      if (!path) return;
      const count = await db.exportChats(path);
      setBackupStatus({
        kind: "success",
        text: `Exported ${count} chat${count === 1 ? "" : "s"}.`,
      });
    } catch (err) {
      setBackupStatus({ kind: "error", text: `Export failed: ${err}` });
    } finally {
      setBackupBusy(false);
    }
  };

  const handleImport = async () => {
    setBackupStatus(null);
    const path = await openDialog({
      title: "Import chats",
      multiple: false,
      filters: [{ name: "Luma backup", extensions: ["lumabackup"] }],
    });
    if (!path) return;
    if (
      !window.confirm(
        "Import chats from this backup? Chats already on this machine with matching IDs will be overwritten.",
      )
    )
      return;
    setBackupBusy(true);
    try {
      const count = await db.importChats(path);
      const sessions = await db.loadSessions();
      setSessionsFromDb(sessions);
      setBackupStatus({
        kind: "success",
        text: `Imported ${count} chat${count === 1 ? "" : "s"}.`,
      });
    } catch (err) {
      setBackupStatus({ kind: "error", text: `Import failed: ${err}` });
    } finally {
      setBackupBusy(false);
    }
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

        {/* ── Ollama server ── */}
        <section className={`${styles.section} ${styles.sectionFull}`}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Ollama server</h2>
            <p className={styles.sectionHint}>
              Connect to a remote Ollama instance. Leave URL blank to use{" "}
              <code>localhost:11434</code>. The API key is sent as a Bearer
              token and also used for Ollama web search — no need to enter it
              twice.
            </p>
          </div>
          <div className={styles.serverRow}>
            <input
              type="url"
              value={ollamaUrl}
              placeholder="http://localhost:11434"
              onChange={(e) => setOllamaUrl(e.target.value)}
              className={styles.textInput}
              aria-label="Ollama server URL"
              autoComplete="off"
              spellCheck={false}
            />
            <input
              type="password"
              value={ollamaApiKey}
              placeholder="API key (optional)"
              onChange={(e) => setOllamaApiKey(e.target.value)}
              className={styles.textInput}
              aria-label="Ollama API key"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </section>

        {/* ── Web search provider ── */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Web search provider</h2>
            <p className={styles.sectionHint}>
              DuckDuckGo needs no setup. Ollama's web search is more reliable
              but requires an API key — being signed in to Ollama is{" "}
              <strong>not</strong> enough.
            </p>
          </div>

          <div
            className={styles.segmented}
            role="radiogroup"
            aria-label="Search provider"
          >
            <button
              role="radio"
              aria-checked={searchProvider === "duckduckgo"}
              onClick={() => setSearchProvider("duckduckgo")}
              className={`${styles.segBtn} ${searchProvider === "duckduckgo" ? styles.segBtnActive : ""}`}
            >
              DuckDuckGo
            </button>
            <button
              role="radio"
              aria-checked={searchProvider === "ollama"}
              onClick={() => setSearchProvider("ollama")}
              className={`${styles.segBtn} ${searchProvider === "ollama" ? styles.segBtnActive : ""}`}
            >
              Ollama
            </button>
          </div>

          {searchProvider === "ollama" && (
            <div className={styles.apiKeyBlock}>
              {ollamaApiKey ? (
                <p className={styles.sectionHint}>
                  Using the API key from{" "}
                  <strong>Ollama server</strong> settings above.
                </p>
              ) : (
                <p className={styles.sectionHint}>
                  Add an API key in the{" "}
                  <strong>Ollama server</strong> section above, or leave blank
                  to fall back to the <code>OLLAMA_API_KEY</code> environment
                  variable. Create a key at{" "}
                  <a
                    href="https://ollama.com/settings/keys"
                    target="_blank"
                    rel="noreferrer"
                    className={styles.link}
                  >
                    ollama.com/settings/keys
                  </a>{" "}
                  (free account).
                </p>
              )}
            </div>
          )}
        </section>

        {/* ── Tool call limit ── */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Tool call limit</h2>
            <p className={styles.sectionHint}>
              Maximum number of tool-calling rounds before the model is forced
              to give a final answer. Leave empty (0) for unlimited.
            </p>
          </div>

          <div className={styles.numberRow}>
            <input
              type="number"
              min={0}
              value={toolCallLimit === 0 ? "" : toolCallLimit}
              placeholder="Unlimited"
              onChange={(e) =>
                setToolCallLimit(
                  e.target.value === "" ? 0 : parseInt(e.target.value, 10),
                )
              }
              className={styles.numberInput}
              aria-label="Tool call limit (0 = unlimited)"
            />
            <span className={styles.numberHint}>
              {toolCallLimit === 0
                ? "Unlimited"
                : `${toolCallLimit} round${toolCallLimit === 1 ? "" : "s"}`}
            </span>
          </div>
        </section>

        {/* ── Backup & restore ── */}
        <section className={`${styles.section} ${styles.sectionFull}`}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Backup & restore</h2>
            <p className={styles.sectionHint}>
              Export all chats (including side chats) to a compressed{" "}
              <code>.lumabackup</code> file, or import one to restore chats on
              this machine. Only chat data is included — settings and API
              keys are not exported.
            </p>
          </div>

          <div className={styles.backupRow}>
            <button
              type="button"
              onClick={handleExport}
              disabled={backupBusy}
              className={styles.resetBtn}
            >
              <Download size={11} />
              Export chats
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={backupBusy}
              className={styles.resetBtn}
            >
              <Upload size={11} />
              Import chats
            </button>
          </div>

          {backupStatus && (
            <p
              className={styles.sectionHint}
              style={{
                color:
                  backupStatus.kind === "error"
                    ? "var(--status-err)"
                    : "var(--status-ok)",
              }}
            >
              {backupStatus.text}
            </p>
          )}
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
