import { useEffect } from "react";
import { PanelRight, PanelRightClose, X } from "lucide-react";
import TitleBar from "./components/TitleBar";
import Sidebar from "./components/Sidebar";
import ChatPane from "./components/ChatPane";
import { useUiStore } from "./store/uiStore";
import { useMainChat } from "./store/chatStore";
import { useSessionStore } from "./store/sessionStore";
import { isOllamaReachable, listLocalModels } from "./lib/ollama";
import { db } from "./lib/db";
import { useDbInit } from "./hooks/useDbInit";
import styles from "./App.module.css";
import "./index.css";

// Lazy load components that are not always needed
import { lazy, Suspense } from "react";
const SidePanel = lazy(() => import("./components/SidePanel"));
const SettingsPage = lazy(() => import("./components/SettingsPage"));

export default function App() {
  const {
    sideChatOpen,
    toggleSideChat,
    setOllamaConnected,
    setAvailableModels,
    setCustomModels,
    settingsOpen,
    openSettings,
    webSearchNotice,
    clearWebSearchNotice,
  } = useUiStore();
  // The main pane needs its session id: attaching or detaching a folder writes
  // the root set to the *session* (and so to SQLite), and that write is guarded
  // on this prop. SidePanel already passed it to its panes; without it here, a
  // folder attached in the main pane lived only in the pane store and was gone
  // on the next session load.
  const activeChatId = useSessionStore((s) => s.activeChatId);
  useDbInit();

  useEffect(() => {
    (async () => {
      const ok = await isOllamaReachable();
      setOllamaConnected(ok);
      if (ok) {
        const models = await listLocalModels();
        setAvailableModels(models);
      }
    })();
  }, [setOllamaConnected, setAvailableModels]);

  useEffect(() => {
    db.loadCustomModels()
      .then(setCustomModels)
      .catch(() => {});
  }, [setCustomModels]);

  // Warm the Temml module cache on idle so the first math-containing message
  // doesn't have to wait for the chunk to download — `MathSpan`'s own
  // `import()` call resolves instantly once this has already run.
  useEffect(() => {
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1));
    const cancelIdle = window.cancelIdleCallback || clearTimeout;
    const id = idle(() => import("temml/dist/temml.mjs"));
    return () => cancelIdle(id);
  }, []);

  const quotaBanner = webSearchNotice ? (
    <div className={styles.quotaBanner} role="alert">
      <span className={styles.quotaBannerText}>{webSearchNotice}</span>
      {!settingsOpen && (
        <button
          className={styles.quotaBannerBtn}
          onClick={() => {
            clearWebSearchNotice();
            openSettings();
          }}
        >
          Open Settings
        </button>
      )}
      <button
        className={styles.quotaBannerClose}
        onClick={clearWebSearchNotice}
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  ) : null;

  return (
    <div className={styles.app}>
      <TitleBar />
      {quotaBanner}

      <div className={styles.content}>
        {/* Kept mounted (just hidden) while Settings is open, so scroll
            positions and in-flight streams survive the trip. */}
        <div
          className={`${styles.body} ${settingsOpen ? styles.bodyHidden : ""}`}
        >
          <Sidebar />

          <div className={styles.mainArea}>
            <div className={styles.topBar}>
              <button
                onClick={toggleSideChat}
                className={`${styles.sideChatToggle} ${sideChatOpen ? styles.sideChatToggleActive : ""}`}
              >
                {sideChatOpen ? (
                  <>
                    <PanelRightClose size={12} /> Close Side Chat
                  </>
                ) : (
                  <>
                    <PanelRight size={12} /> Side Chat
                  </>
                )}
              </button>
            </div>

            <div className={styles.chatArea}>
              <div
                className={`${styles.mainPane} ${sideChatOpen ? styles.mainPaneSplit : ""}`}
              >
                <ChatPane
                  store={useMainChat}
                  sessionId={activeChatId}
                  placeholder="Ask anything…"
                  label="Main Chat"
                  compact={sideChatOpen}
                />
              </div>
              {sideChatOpen && (
                <Suspense
                  fallback={<div className={styles.loading}>Loading...</div>}
                >
                  <SidePanel />
                </Suspense>
              )}
            </div>
          </div>
        </div>

        {settingsOpen && (
          <div className={styles.settingsOverlay}>
            <Suspense
              fallback={<div className={styles.loading}>Loading...</div>}
            >
              <SettingsPage />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}
