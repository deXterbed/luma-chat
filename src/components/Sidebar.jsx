import { useState } from "react";
import { Plus, MessageSquare, Wifi, WifiOff } from "lucide-react";
import { useAppStore, useMainChat, useSideChat } from "../store";
import { getTheme } from "../theme";

export default function Sidebar() {
  const {
    chatSessions,
    activeChatId,
    ollamaConnected,
    setActiveChatId,
    theme,
  } = useAppStore();
  const t = getTheme(theme);
  const clearMain = useMainChat((s) => s.clearMessages);
  const clearSide = useSideChat((s) => s.clearMessages);
  const loadMessages = useMainChat((s) => s.loadMessages);

  const handleNewChat = () => {
    clearMain();
    clearSide();
    setActiveChatId(null);
  };

  const handleLoadSession = (session) => {
    if (session.messages) loadMessages(session.messages, session.model);
    setActiveChatId(session.id);
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
          <button
            key={session.id}
            onClick={() => handleLoadSession(session)}
            style={{
              width: "100%",
              padding: "7px 8px",
              background:
                activeChatId === session.id ? t.surfaceHover : "transparent",
              border: "none",
              borderRadius: "5px",
              color: activeChatId === session.id ? t.text : t.textMuted,
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
            onMouseEnter={(e) => {
              if (activeChatId !== session.id) {
                e.currentTarget.style.background = t.surfaceHover;
                e.currentTarget.style.color = t.textSubtle;
              }
            }}
            onMouseLeave={(e) => {
              if (activeChatId !== session.id) {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = t.textMuted;
              }
            }}
          >
            <MessageSquare size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: "11px",
              }}
            >
              {session.title}
            </span>
          </button>
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
