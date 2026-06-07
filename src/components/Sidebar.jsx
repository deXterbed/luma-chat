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
import { useUiStore } from "../store/uiStore";
import { useSessionStore } from "../store/sessionStore";
import { getTheme } from "../theme";

export default function Sidebar() {
  const { chatSessions, activeChatId, setActiveChatId, removeChatSession } = useSessionStore();
  const { ollamaConnected, theme } = useUiStore();
  const t = getTheme(theme);
  const clearMain = useMainChat((s) => s.clearMessages);
  const loadMessages = useMainChat((s) => s.loadMessages);

  const handleNewChat = () => {
    clearMain();
    setActiveChatId(null);
  };

  const handleLoadSession = (session) => {
    if (session.messages) loadMessages(session.messages, session.model);
    setActiveChatId(session.id);
  };

  const handleDeleteSession = (session, e) => {
    // Don't let the click bubble up to the row's onClick (which would
    // re-load the session we're about to delete).
    e.stopPropagation();
    const wasActive = activeChatId === session.id;
    removeChatSession(session.id);
    // If we deleted the active session, also clear the main chat pane
    // so the user isn't left looking at messages from a deleted session.
    if (wasActive) {
      clearMain();
      clearSide();
    }
  };

  return (
    <div
      style={{
        width: "220px",
        minWidth: "220px",
        background: "var(--bg-alt)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        fontFamily: "'Geist', sans-serif",
      }}
    >
      {/* New chat button */}
      <div style={{ padding: "12px 10px 8px" }}>
        <button
          onClick={handleNewChat}
          style={{
            width: "100%",
            padding: "8px 12px",
            background: "transparent",
            border: "1px solid var(--border-strong)",
            borderRadius: "6px",
            color: "var(--text-subtle)",
            fontSize: "12px",
            fontFamily: "'Geist', sans-serif",
            fontWeight: "500",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            transition: "all 0.15s",
            letterSpacing: "0.04em",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = t.surfaceHover;
            e.currentTarget.style.color = t.text;
            e.currentTarget.style.borderColor = t.borderStrong;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = t.textSubtle;
            e.currentTarget.style.borderColor = t.borderStrong;
          }}
        >
          <Plus size={13} />
          New Chat
        </button>
      </div>

      {/* Chat list */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "4px 8px",
        }}
      >
        <div
          style={{
            fontSize: "10px",
            color: "var(--text-faint)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            padding: "8px 6px 6px",
            fontWeight: "600",
          }}
        >
          Recent
        </div>

        {chatSessions.length === 0 && (
          <div
            style={{
              padding: "12px 8px",
              fontSize: "11px",
              color: "var(--text-faint)",
              lineHeight: 1.5,
            }}
          >
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
            t={t}
          />
        ))}
      </div>

      {/* Bottom status */}
      <div
        style={{
          padding: "10px 14px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        {ollamaConnected ? (
          <Wifi size={11} color={t.statusOk} />
        ) : (
          <WifiOff size={11} color={t.statusErr} />
        )}
        <span
          style={{
            fontSize: "10px",
            color: ollamaConnected ? t.statusOk : t.statusErr,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {ollamaConnected ? "Ollama connected" : "Ollama offline"}
        </span>
      </div>
    </div>
  );
}

// A single row in the chat list. Has two visual states:
//   - idle: hover shows the trash icon
//   - confirming: clicking trash replaces it with ✓ / ✕ buttons and a
//     3-second auto-cancel timeout. This keeps deletion inline in the
//     sidebar (no modal popup) and gives the user an obvious escape hatch.
function SessionRow({ session, isActive, onLoad, onDelete, t }) {
  const [hovered, setHovered] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Auto-cancel the confirmation after 3s of inactivity, so a stray
  // click doesn't leave the row stuck in a "press ✓ to confirm" state.
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

  return (
    <div
      onClick={onLoad}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        // Cancel any pending confirmation when the user moves away —
        // feels more natural than having the buttons linger after
        // the user's focus has shifted to another row.
        setConfirming(false);
      }}
      style={{
        width: "100%",
        padding: "7px 8px",
        background: confirming
          ? t.surfaceActive
          : isActive
            ? t.surfaceHover
            : hovered
              ? t.surfaceHover
              : "transparent",
        border: "none",
        borderRadius: "5px",
        color: isActive ? t.text : t.textMuted,
        fontSize: "12px",
        fontFamily: "'Geist', sans-serif",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        textAlign: "left",
        transition: "all 0.15s",
        overflow: "hidden",
      }}
    >
      {confirming ? (
        <>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: "11px",
              color: t.text,
              fontWeight: "500",
            }}
          >
            Delete?
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(e);
            }}
            aria-label="Confirm delete"
            title="Confirm delete"
            style={{
              background: "transparent",
              border: "none",
              padding: "3px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: t.statusErr,
              cursor: "pointer",
              borderRadius: "3px",
              transition: "all 0.15s",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = t.statusErr + "22"; // ~13% alpha
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <Check size={12} />
          </button>
          <button
            onClick={handleCancel}
            aria-label="Cancel delete"
            title="Cancel"
            style={{
              background: "transparent",
              border: "none",
              padding: "3px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: t.textMuted,
              cursor: "pointer",
              borderRadius: "3px",
              transition: "all 0.15s",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = t.surfaceHover;
              e.currentTarget.style.color = t.text;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = t.textMuted;
            }}
          >
            <X size={12} />
          </button>
        </>
      ) : (
        <>
          <MessageSquare size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "11px",
            }}
          >
            {session.title}
          </span>
          <button
            onClick={handleTrashClick}
            aria-label={`Delete ${session.title}`}
            title="Delete chat"
            style={{
              // Always render so the layout doesn't shift on hover, but
              // fade in/out so it doesn't compete with the title visually.
              opacity: hovered ? 1 : 0,
              pointerEvents: hovered ? "auto" : "none",
              background: "transparent",
              border: "none",
              padding: "2px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: t.textFaint,
              cursor: "pointer",
              borderRadius: "3px",
              transition: "all 0.15s",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = t.statusErr;
              e.currentTarget.style.background = t.surfaceActive;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = t.textFaint;
              e.currentTarget.style.background = "transparent";
            }}
          >
            <Trash2 size={11} />
          </button>
        </>
      )}
    </div>
  );
}
