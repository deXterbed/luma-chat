import { useEffect, useState } from "react";
import {
  Check,
  Plus,
  MessageSquare,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { useMainChat } from "../store";
import { db } from "../lib/db";
import { useUiStore } from "../store/uiStore";
import { useSessionStore } from "../store/sessionStore";
import styles from "./Sidebar.module.css";

export default function Sidebar() {
  const {
    chatSessions,
    activeChatId,
    setActiveChatId,
    removeChatSession,
    hydrateSession,
  } = useSessionStore();
  const { ollamaConnected, theme } = useUiStore();
  const clearMain = useMainChat((s) => s.clearMessages);
  const loadMessages = useMainChat((s) => s.loadMessages);

  const handleNewChat = () => {
    clearMain();
    setActiveChatId(null);
  };

  const handleLoadSession = async (session) => {
    setActiveChatId(session.id);
    if (session.messages.length > 0) {
      loadMessages(session.messages, session.model);
      return;
    }
    const data = await hydrateSession(session.id);
    loadMessages(data.messages, session.model);
  };

  const handleDeleteSession = (session, e) => {
    e.stopPropagation();
    const wasActive = activeChatId === session.id;
    removeChatSession(session.id);
    if (wasActive) {
      clearMain();
    }
  };

  return (
    <div className={styles.sidebar}>
      <div className={styles.newChatArea}>
        <button onClick={handleNewChat} className={styles.newChatBtn}>
          <Plus size={13} />
          New Chat
        </button>
      </div>

      <div className={styles.chatList}>
        <div className={styles.sectionLabel}>Recent</div>

        {chatSessions.length === 0 && (
          <div className={styles.emptyHint}>
            No chats yet. Start a conversation.
          </div>
        )}

        {chatSessions.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            isActive={activeChatId === session.id}
            onLoad={() => handleLoadSession(session)}
            onDelete={(e) => handleDeleteSession(session, e)}
          />
        ))}
      </div>

      <div className={styles.statusBar}>
        {ollamaConnected ? (
          <Wifi size={11} color={ollamaConnected ? "#4ade80" : "#f87171"} />
        ) : (
          <WifiOff size={11} color={ollamaConnected ? "#4ade80" : "#f87171"} />
        )}
        <span
          className={styles.statusText}
          style={{ color: ollamaConnected ? "#4ade80" : "#f87171" }}
        >
          {ollamaConnected ? "Ollama connected" : "Ollama offline"}
        </span>
      </div>
    </div>
  );
}

function SessionRow({ session, isActive, onLoad, onDelete }) {
  const [hovered, setHovered] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const id = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(id);
  }, [confirming]);

  const handleTrashClick = (e) => {
    e.stopPropagation();
    setConfirming(true);
  };

  const handleCancel = (e) => {
    e.stopPropagation();
    setConfirming(false);
  };

  const rowClass = [
    styles.row,
    isActive && styles.rowActive,
    confirming && styles.rowConfirming,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      onClick={onLoad}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setConfirming(false);
      }}
      className={rowClass}
    >
      {confirming ? (
        <>
          <span className={styles.confirmLabel}>Delete?</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(e);
            }}
            aria-label="Confirm delete"
            title="Confirm delete"
            className={`${styles.confirmBtn} ${styles.confirmBtnDanger}`}
          >
            <Check size={12} />
          </button>
          <button
            onClick={handleCancel}
            aria-label="Cancel delete"
            title="Cancel"
            className={`${styles.confirmBtn} ${styles.confirmBtnCancel}`}
          >
            <X size={12} />
          </button>
        </>
      ) : (
        <>
          <MessageSquare size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
          <span className={styles.rowTitle}>{session.title}</span>
          <button
            onClick={handleTrashClick}
            aria-label={`Delete ${session.title}`}
            title="Delete chat"
            className={`${styles.trashBtn} ${hovered ? styles.trashBtnVisible : ""}`}
          >
            <Trash2 size={11} />
          </button>
        </>
      )}
    </div>
  );
}
