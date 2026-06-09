import { useEffect, useRef, useState } from "react";
import ChatPane from "./ChatPane";
import { useUiStore } from "../store/uiStore";
import { useSessionStore } from "../store/sessionStore";
import { useMainChat, getSideChatStore } from "../store/chatStore";
import styles from "./SidePanel.module.css";

export default function SidePanel() {
  const { chatSessions, activeChatId, addSideChat, setActiveSideChatId } =
    useSessionStore();
  const theme = useUiStore((s) => s.theme);

  const currentSession =
    chatSessions.find((s) => s.id === activeChatId) ?? null;
  const sessionSideChats = currentSession?.sideChats ?? [];
  const activeSideChatId = currentSession?.activeSideChatId ?? null;

  const [sideWidth, setSideWidth] = useState(600);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

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

  useEffect(() => {
    if (!activeChatId || !currentSession) return;
    if (sessionSideChats.length === 0) {
      addSideChat(
        activeChatId,
        getSideChatStore(activeSideChatId).getState().model,
      );
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

  useEffect(() => {
    if (!activeChatId) getSideChatStore(null).getState().clearMessages();
  }, [activeChatId]);

  const handleAddSideChat = () => {
    if (!activeChatId) return;
    const currentModel = getSideChatStore(activeSideChatId).getState().model;
    addSideChat(activeChatId, currentModel);
  };

  const handleSwitchSideChat = (id) => {
    const sc = sessionSideChats.find((sc) => sc.id === id);
    if (!sc) return;
    getSideChatStore(id)
      .getState()
      .loadMessages(sc.messages ?? [], sc.model ?? "minimax-m3:cloud");
    setActiveSideChatId(activeChatId, id);
  };

  return (
    <>
      <div onMouseDown={onMouseDown} className={styles.handle} />

      <div className={styles.panel} style={{ width: `${sideWidth}px`, minWidth: "320px", maxWidth: "800px" }}>
        {activeSideChatId && (
          <div className={styles.tabBar}>
            {sessionSideChats.map((sc, i) => (
              <button
                key={sc.id}
                onClick={() => handleSwitchSideChat(sc.id)}
                className={`${styles.tab} ${sc.id === activeSideChatId ? styles.tabActive : ""}`}
              >
                {i + 1}
              </button>
            ))}
            <button onClick={handleAddSideChat} className={styles.addTabBtn} title="New side chat">
              +
            </button>
          </div>
        )}

        <div className={styles.paneContent}>
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
