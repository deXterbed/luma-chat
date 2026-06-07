import { useEffect, useRef, useState } from "react";
import ChatPane from "./ChatPane";
import { useUiStore } from "../store/uiStore";
import { useSessionStore } from "../store/sessionStore";
import { useMainChat, getSideChatStore } from "../store/chatStore";
import { getTheme } from "../theme";

export default function SidePanel() {
  const { chatSessions, activeChatId, addSideChat, setActiveSideChatId } =
    useSessionStore();
  const theme = useUiStore((s) => s.theme);
  const t = getTheme(theme);

  const currentSession =
    chatSessions.find((s) => s.id === activeChatId) ?? null;
  const sessionSideChats = currentSession?.sideChats ?? [];
  const activeSideChatId = currentSession?.activeSideChatId ?? null;

  const [sideWidth, setSideWidth] = useState(600);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  // Resize drag
  const onMouseDown = (e) => {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = sideWidth;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!isDragging.current) return;
      const delta = dragStartX.current - e.clientX;
      setSideWidth(
        Math.max(320, Math.min(800, dragStartWidth.current + delta)),
      );
    };
    const onMouseUp = () => {
      isDragging.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Load the correct side chat when the active session changes
  useEffect(() => {
    if (!activeChatId || !currentSession) return;
    if (sessionSideChats.length === 0) {
      addSideChat(activeChatId, getSideChatStore(activeSideChatId).getState().model);
    } else {
      const sc =
        sessionSideChats.find((sc) => sc.id === activeSideChatId) ??
        sessionSideChats[0];
      getSideChatStore(sc.id)
        .getState()
        .loadMessages(sc.messages ?? [], sc.model ?? "minimax-m3:cloud");
      if (!activeSideChatId) setActiveSideChatId(activeChatId, sc.id);
    }
  }, [activeChatId]);

  // Clear the fallback store when no session is active
  useEffect(() => {
    if (!activeChatId) getSideChatStore(null).getState().clearMessages();
  }, [activeChatId]);

  const handleAddSideChat = () => {
    if (!activeChatId) return;
    const currentModel = getSideChatStore(activeSideChatId).getState().model;
    addSideChat(activeChatId, currentModel);
    // New side chat's store starts empty — no manual clear needed
  };

  const handleSwitchSideChat = (id) => {
    const sc = sessionSideChats.find((sc) => sc.id === id);
    if (!sc) return;
    // Load into the target tab's own store — never touches the active stream
    getSideChatStore(id)
      .getState()
      .loadMessages(sc.messages ?? [], sc.model ?? "minimax-m3:cloud");
    setActiveSideChatId(activeChatId, id);
  };

  return (
    <>
      {/* Drag handle */}
      <div
        onMouseDown={onMouseDown}
        style={{
          width: "4px",
          background: "var(--handlebar)",
          cursor: "col-resize",
          flexShrink: 0,
          transition: "background 0.15s",
          zIndex: 10,
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = t.accentSubtle)
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.background = "var(--handlebar)")
        }
      />

      {/* Panel */}
      <div
        style={{
          width: `${sideWidth}px`,
          minWidth: "320px",
          maxWidth: "800px",
          borderLeft: "1px solid var(--border)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          animation: "slideInRight 0.2s ease-out",
        }}
      >
        {/* Tab bar */}
        {activeSideChatId && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-alt)",
              flexShrink: 0,
              overflowX: "auto",
              scrollbarWidth: "none",
            }}
          >
            {sessionSideChats.map((sc, i) => (
              <button
                key={sc.id}
                onClick={() => handleSwitchSideChat(sc.id)}
                style={{
                  padding: "6px 14px",
                  background: "transparent",
                  border: "none",
                  borderBottom:
                    sc.id === activeSideChatId
                      ? "2px solid " + t.accent
                      : "2px solid transparent",
                  color: sc.id === activeSideChatId ? t.accent : t.textFaint,
                  fontSize: "10px",
                  fontFamily: "'JetBrains Mono', monospace",
                  cursor: "pointer",
                  flexShrink: 0,
                  transition: "color 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (sc.id !== activeSideChatId)
                    e.currentTarget.style.color = t.textSubtle;
                }}
                onMouseLeave={(e) => {
                  if (sc.id !== activeSideChatId)
                    e.currentTarget.style.color = t.textFaint;
                }}
              >
                {i + 1}
              </button>
            ))}
            <button
              onClick={handleAddSideChat}
              style={{
                padding: "4px 10px",
                background: "transparent",
                border: "none",
                color: t.textFaint,
                fontSize: "14px",
                cursor: "pointer",
                flexShrink: 0,
                lineHeight: 1,
                transition: "color 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = t.accent)}
              onMouseLeave={(e) => (e.currentTarget.style.color = t.textFaint)}
              title="New side chat"
            >
              +
            </button>
          </div>
        )}

        <div style={{ flex: 1, overflow: "hidden" }}>
          <ChatPane
            key={activeSideChatId ?? "default"}
            store={getSideChatStore(activeSideChatId)}
            contextStore={useMainChat}
            isSideChat={true}
            sideChatId={activeSideChatId}
            sessionId={activeChatId}
            placeholder="Side questions…"
            label="Side Chat"
            compact={true}
          />
        </div>
      </div>
    </>
  );
}
