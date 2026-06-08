import { useEffect } from "react";
import { PanelRight, PanelRightClose } from "lucide-react";
import TitleBar from "./components/TitleBar";
import Sidebar from "./components/Sidebar";
import ChatPane from "./components/ChatPane";
import SidePanel from "./components/SidePanel";
import { useUiStore } from "./store/uiStore";
import { useMainChat } from "./store/chatStore";
import { isOllamaReachable, listLocalModels } from "./lib/ollama";
import { useDbInit } from "./hooks/useDbInit";
import { getTheme } from "./theme";
import "./index.css";

export default function App() {
  const {
    sideChatOpen,
    toggleSideChat,
    setOllamaConnected,
    setAvailableModels,
    theme,
  } = useUiStore();
  useDbInit();
  const t = getTheme(theme);

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

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100vw",
        background: "var(--bg)",
        overflow: "hidden",
        fontFamily: "'Geist', sans-serif",
      }}
    >
      <TitleBar />

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <Sidebar />

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Top bar */}
          <div
            style={{
              padding: "0 16px",
              height: "38px",
              background: "var(--bg-alt)",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              flexShrink: 0,
            }}
          >
            <button
              onClick={toggleSideChat}
              style={{
                background: sideChatOpen ? t.surfaceActive : "transparent",
                border: sideChatOpen
                  ? "1px solid " + t.borderStrong
                  : "1px solid var(--border)",
                borderRadius: "5px",
                padding: "4px 10px",
                color: sideChatOpen ? t.accent : t.textFaint,
                fontSize: "11px",
                fontFamily: "'Geist', sans-serif",
                fontWeight: "500",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                transition: "all 0.15s",
                letterSpacing: "0.04em",
              }}
              onMouseEnter={(e) => {
                if (!sideChatOpen) {
                  e.currentTarget.style.background = t.surfaceHover;
                  e.currentTarget.style.color = t.accentDim;
                  e.currentTarget.style.borderColor = t.borderStrong;
                }
              }}
              onMouseLeave={(e) => {
                if (!sideChatOpen) {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = t.textFaint;
                  e.currentTarget.style.borderColor = t.border;
                }
              }}
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

          {/* Chat area */}
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            <div
              style={{
                flex: 1,
                overflow: "hidden",
                borderRight: sideChatOpen
                  ? "1px solid var(--border)"
                  : "1px solid transparent",
                transition: "flex 0.25s ease, border-color 0.2s ease",
              }}
            >
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
