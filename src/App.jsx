import { useEffect } from "react";
import { PanelRight, PanelRightClose } from "lucide-react";
import TitleBar from "./components/TitleBar";
import Sidebar from "./components/Sidebar";
import ChatPane from "./components/ChatPane";
import SidePanel from "./components/SidePanel";
import { useUiStore } from "./store/uiStore";
import { useMainChat } from "./store/chatStore";
import { isOllamaReachable, listLocalModels } from "./lib/ollama";
import { db } from "./lib/db";
import { useDbInit } from "./hooks/useDbInit";
import styles from "./App.module.css";
import "./index.css";

export default function App() {
  const {
    sideChatOpen,
    toggleSideChat,
    setOllamaConnected,
    setAvailableModels,
    setCustomModels,
    theme,
  } = useUiStore();
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

  return (
    <div className={styles.app}>
      <TitleBar />

      <div className={styles.body}>
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
            <div className={`${styles.mainPane} ${sideChatOpen ? styles.mainPaneSplit : ""}`}>
              <ChatPane
                store={useMainChat}
                placeholder="Ask anything…"
                label="Main Chat"
                compact={sideChatOpen}
              />
            </div>
            {sideChatOpen && <SidePanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
