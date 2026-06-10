import { useEffect, useRef, useState } from "react";
import ChatPane from "./ChatPane";
import { useSessionStore } from "../store/sessionStore";
import { useMainChat, getSideChatStore } from "../store/chatStore";
import styles from "./SidePanel.module.css";

function TabButton({ sc, index, isActive, onClick }) {
  const isStreaming = getSideChatStore(sc.id)((s) => s.isStreaming);
  return (
    <button
      onClick={onClick}
      className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
    >
      {index + 1}
      {isStreaming && <span className={styles.streamingDot} />}
    </button>
  );
}

export default function SidePanel() {
  const { chatSessions, activeChatId, addSideChat, setActiveSideChatId } =
    useSessionStore();
  const mainChatHasMessages = useMainChat((s) => s.messages.length > 0);

  const currentSession = chatSessions.find((s) => s.id === activeChatId) ?? null;
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
      setSideWidth(Math.max(320, Math.min(800, dragStartWidth.current + delta)));
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

  // On session switch: seed each tab's store from sessionStore (persisted messages).
  // New tabs get an auto-created empty store on first getSideChatStore(id) call.
  useEffect(() => {
    if (!activeChatId) return;
    const sess = useSessionStore
      .getState()
      .chatSessions.find((s) => s.id === activeChatId);
    if (!sess) return;
    const sideChats = sess.sideChats ?? [];
    if (sideChats.length === 0) {
      addSideChat(activeChatId);
    } else {
      sideChats.forEach((sc) => {
        const tabStore = getSideChatStore(sc.id);
        if (!tabStore.getState().isStreaming)
          tabStore.getState().loadMessages(sc.messages ?? [], sc.model ?? "minimax-m3:cloud");
      });
      if (!sess.activeSideChatId)
        setActiveSideChatId(activeChatId, sideChats[0].id);
    }
  }, [activeChatId]);

  const handleAddTab = () => {
    if (!activeChatId) return;
    // If a tab is active, match its model; otherwise let addSideChat
    // fall back to the user's default model from settings.
    const model = activeSideChatId
      ? getSideChatStore(activeSideChatId).getState().model
      : undefined;
    addSideChat(activeChatId, model);
  };

  const handleSwitchTab = (id) => {
    if (id === activeSideChatId) return;
    setActiveSideChatId(activeChatId, id);
  };

  return (
    <>
      <div onMouseDown={onMouseDown} className={styles.handle} />

      <div
        className={styles.panel}
        style={{ width: `${sideWidth}px`, minWidth: "320px", maxWidth: "800px" }}
      >
        <div className={styles.tabBar}>
          {sessionSideChats.map((sc, i) => (
            <TabButton
              key={sc.id}
              sc={sc}
              index={i}
              isActive={sc.id === activeSideChatId}
              onClick={() => handleSwitchTab(sc.id)}
            />
          ))}
          {mainChatHasMessages && (
            <button
              onClick={handleAddTab}
              className={styles.addTabBtn}
              title="New side chat"
            >
              +
            </button>
          )}
        </div>

        <div className={styles.paneContent}>
          {sessionSideChats.map((sc) => (
            <div
              key={sc.id}
              style={{
                display: sc.id === activeSideChatId ? "flex" : "none",
                flexDirection: "column",
                height: "100%",
              }}
            >
              <ChatPane
                store={getSideChatStore(sc.id)}
                contextStore={useMainChat}
                isSideChat={true}
                isActive={sc.id === activeSideChatId}
                sideChatId={sc.id}
                sessionId={activeChatId}
                placeholder="Side questions…"
                label="Side Chat"
                compact={true}
              />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
