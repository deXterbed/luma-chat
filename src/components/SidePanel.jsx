import { useEffect, useRef, useState } from "react";
import ChatPane from "./ChatPane";
import { useSessionStore } from "../store/sessionStore";
import { useMainChat, getSideChatStore } from "../store/chatStore";
import styles from "./SidePanel.module.css";

function TabButton({ sc, label, parentLabel, isActive, onClick }) {
  const isStreaming = getSideChatStore(sc.id)((s) => s.isStreaming);
  return (
    <button
      onClick={onClick}
      title={parentLabel ? `Branched from ${parentLabel}` : undefined}
      className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
    >
      {label}
      {isStreaming && <span className={styles.streamingDot} />}
    </button>
  );
}

// Builds the tab display order and path labels together via a depth-first
// walk of the parent/child tree, so a child tab always sits right after its
// parent (rather than wherever it falls in raw creation order). Top-level
// side chats are "1", "2", ...; each level of branching appends ".N" for its
// position among siblings — e.g. side chat "1"'s children are "1.1", "1.2",
// and "1.1"'s children are "1.1.1", "1.1.2". A side chat whose parent was
// deleted is treated as top-level so it never disappears from the tab bar.
function buildSideChatTree(sideChats) {
  const idSet = new Set(sideChats.map((sc) => sc.id));
  const childrenByParent = new Map();
  sideChats.forEach((sc) => {
    const key =
      sc.parentSideChatId && idSet.has(sc.parentSideChatId)
        ? sc.parentSideChatId
        : null;
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(sc);
  });
  const labels = {};
  const ordered = [];
  const assign = (parentId, prefix) => {
    (childrenByParent.get(parentId) || []).forEach((sc, i) => {
      const label = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      labels[sc.id] = label;
      ordered.push(sc);
      assign(sc.id, label);
    });
  };
  assign(null, "");
  return { ordered, labels };
}

export default function SidePanel() {
  const { chatSessions, activeChatId, addSideChat, setActiveSideChatId } =
    useSessionStore();
  const mainChatHasMessages = useMainChat((s) => s.messages.length > 0);

  const currentSession = chatSessions.find((s) => s.id === activeChatId) ?? null;
  const sessionSideChats = currentSession?.sideChats ?? [];
  const activeSideChatId = currentSession?.activeSideChatId ?? null;
  const { ordered: orderedSideChats, labels: sideChatLabels } =
    buildSideChatTree(sessionSideChats);

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
      addSideChat(activeChatId, useMainChat.getState().model || undefined);
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
      : useMainChat.getState().model || undefined;
    addSideChat(activeChatId, model);
  };

  const handleSwitchTab = (id) => {
    if (id === activeSideChatId) return;
    setActiveSideChatId(activeChatId, id);
  };

  // Branch a new side chat off of an existing one — the new tab's context
  // (see contextStore below) comes from the parent side chat, not the main chat.
  const handleBranchTab = (parentSideChatId) => {
    if (!activeChatId) return;
    const model = getSideChatStore(parentSideChatId).getState().model;
    addSideChat(activeChatId, model, parentSideChatId);
  };

  return (
    <>
      <div onMouseDown={onMouseDown} className={styles.handle} />

      <div
        className={styles.panel}
        style={{ width: `${sideWidth}px`, minWidth: "320px", maxWidth: "800px" }}
      >
        <div className={styles.tabBar}>
          {orderedSideChats.map((sc) => (
            <TabButton
              key={sc.id}
              sc={sc}
              label={sideChatLabels[sc.id]}
              parentLabel={
                sc.parentSideChatId ? sideChatLabels[sc.parentSideChatId] : null
              }
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
          {orderedSideChats.map((sc) => (
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
                contextStore={
                  sc.parentSideChatId
                    ? getSideChatStore(sc.parentSideChatId)
                    : useMainChat
                }
                isSideChat={true}
                isActive={sc.id === activeSideChatId}
                sideChatId={sc.id}
                sessionId={activeChatId}
                onBranch={() => handleBranchTab(sc.id)}
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
