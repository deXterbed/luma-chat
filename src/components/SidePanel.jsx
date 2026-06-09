import { useEffect, useRef, useState } from "react";
import ChatPane from "./ChatPane";
import { useUiStore } from "../store/uiStore";
import { useSessionStore } from "../store/sessionStore";
import { useMainChat, getSideChatStore } from "../store/chatStore";
import styles from "./SidePanel.module.css";

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

  // When the active session changes (or on first mount), ensure a side chat
  // record exists and load its messages into the session-scoped store.
  useEffect(() => {
    if (!activeChatId) {
      getSideChatStore(null).getState().clearMessages();
      return;
    }
    // Read fresh from the store — the closure values may be one render behind.
    const sess = useSessionStore
      .getState()
      .chatSessions.find((s) => s.id === activeChatId);
    if (!sess) return;

    const sideChats = sess.sideChats ?? [];
    const activeId = sess.activeSideChatId ?? null;
    const store = getSideChatStore(activeChatId);

    if (sideChats.length === 0) {
      // No side chat yet for this session — create the first one.
      addSideChat(activeChatId, store.getState().model);
    } else {
      // Load the active tab's messages (fall back to the first tab).
      const sc = sideChats.find((sc) => sc.id === activeId) ?? sideChats[0];
      store.getState().loadMessages(sc.messages ?? [], sc.model ?? "minimax-m3:cloud");
      if (!activeId) setActiveSideChatId(activeChatId, sc.id);
    }
  }, [activeChatId]);

  const handleAddTab = () => {
    if (!activeChatId) return;
    const store = getSideChatStore(activeChatId);
    const model = store.getState().model;
    addSideChat(activeChatId, model);
    // The new tab is empty — clear whatever the previous tab had loaded.
    store.getState().clearMessages();
  };

  const handleSwitchTab = (id) => {
    if (id === activeSideChatId) return;
    const sess = useSessionStore.getState().chatSessions.find((s) => s.id === activeChatId);
    const sc = sess?.sideChats.find((sc) => sc.id === id);
    if (!sc) return;
    getSideChatStore(activeChatId)
      .getState()
      .loadMessages(sc.messages ?? [], sc.model ?? "minimax-m3:cloud");
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
            <button
              key={sc.id}
              onClick={() => handleSwitchTab(sc.id)}
              className={`${styles.tab} ${sc.id === activeSideChatId ? styles.tabActive : ""}`}
            >
              {i + 1}
            </button>
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
          <ChatPane
            key={activeSideChatId ?? activeChatId ?? "default"}
            store={getSideChatStore(activeChatId)}
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
