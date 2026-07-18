import { useEffect, useRef, useState } from "react";
import ChatPane from "./ChatPane";
import { useSessionStore } from "../store/sessionStore";
import { useMainChat, getSideChatStore } from "../store/chatStore";
import styles from "./SidePanel.module.css";

function TabButton({ sc, label, parentLabel, isActive, onClick }) {
  const isStreaming = getSideChatStore(sc.id)((s) => s.isStreaming);
  const firstQuestion = getSideChatStore(sc.id)((s) =>
    s.messages.find((m) => m.role === "user")?.content,
  );
  const tooltip = firstQuestion
    ? firstQuestion.length > 200
      ? `${firstQuestion.slice(0, 200)}…`
      : firstQuestion
    : parentLabel
      ? `Branched from ${parentLabel}`
      : undefined;
  return (
    <button
      onClick={onClick}
      title={tooltip}
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
  return { ordered, labels, childrenByParent };
}

// Builds the rows shown in the tab bar: the root row (top-level side chats),
// then one row per ancestor along the path from root down to the active tab,
// each row listing that ancestor's children. This means a branch's children
// are only visible while you're inside that branch (active tab is it or one
// of its descendants) — switching away collapses the row, keeping the tab
// bar from growing unbounded as chats get nested deeper.
function buildTabRows(childrenByParent, sideChats, activeId) {
  const idSet = new Set(sideChats.map((sc) => sc.id));
  const byId = new Map(sideChats.map((sc) => [sc.id, sc]));
  const rows = [];
  const rootRow = childrenByParent.get(null) || [];
  if (rootRow.length) rows.push(rootRow);

  const path = [];
  let current = activeId;
  while (current) {
    path.unshift(current);
    const sc = byId.get(current);
    const parent = sc?.parentSideChatId;
    current = parent && idSet.has(parent) ? parent : null;
  }
  path.forEach((id) => {
    const children = childrenByParent.get(id) || [];
    if (children.length) rows.push(children);
  });
  return rows;
}

export default function SidePanel() {
  const { chatSessions, activeChatId, addSideChat, setActiveSideChatId } =
    useSessionStore();
  const mainChatHasMessages = useMainChat((s) => s.messages.length > 0);

  const currentSession =
    chatSessions.find((s) => s.id === activeChatId) ?? null;
  const sessionSideChats = currentSession?.sideChats ?? [];
  const activeSideChatId = currentSession?.activeSideChatId ?? null;
  const {
    ordered: orderedSideChats,
    labels: sideChatLabels,
    childrenByParent,
  } = buildSideChatTree(sessionSideChats);
  const tabRows = buildTabRows(
    childrenByParent,
    sessionSideChats,
    activeSideChatId,
  );

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
          tabStore
            .getState()
            .loadMessages(sc.messages ?? [], sc.model ?? "minimax-m3:cloud");
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
    // Focus the newly-active tab's input. Done here (not in setActiveSideChatId)
    // so main-session switching — which sets a side chat active in the
    // [activeChatId] effect below — doesn't steal focus from the main input.
    getSideChatStore(id).getState().bumpFocus();
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
        style={{
          width: `${sideWidth}px`,
          minWidth: "320px",
          maxWidth: "800px",
        }}
      >
        <div className={styles.tabBar}>
          {tabRows.map((row, depth) => (
            <div
              key={depth}
              className={styles.tabRow}
              style={{ paddingLeft: `${depth * 20}px` }}
            >
              {row.map((sc) => (
                <TabButton
                  key={sc.id}
                  sc={sc}
                  label={sideChatLabels[sc.id]}
                  parentLabel={
                    sc.parentSideChatId
                      ? sideChatLabels[sc.parentSideChatId]
                      : null
                  }
                  isActive={sc.id === activeSideChatId}
                  onClick={() => handleSwitchTab(sc.id)}
                />
              ))}
              {depth === 0 && mainChatHasMessages && (
                <button
                  onClick={handleAddTab}
                  className={styles.addTabBtn}
                  title="New side chat"
                >
                  +
                </button>
              )}
            </div>
          ))}
        </div>

        <div className={styles.paneContent}>
          {orderedSideChats.map((sc) => (
            <div
              key={sc.id}
              className={`${styles.tabPane} ${sc.id === activeSideChatId ? styles.tabPaneActive : ""}`}
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
