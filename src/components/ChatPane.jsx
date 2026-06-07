import { useRef, useEffect, useState } from "react";
import MessageBubble from "./MessageBubble";
import ModelPicker from "./ModelPicker";
import InputArea from "./InputArea";
import { useStreamingChat } from "../hooks/useStreamingChat";
import { useUiStore } from "../store/uiStore";
import { getTheme } from "../theme";

export default function ChatPane({
  store,
  contextStore,
  sideChatId,
  sessionId,
  placeholder = "Ask anything…",
  compact = false,
  isSideChat = false,
  label = "Chat",
}) {
  const { messages, model, setModel } = store();
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const { handleSend, isStreaming, stopStreaming, error } = useStreamingChat({
    store,
    contextStore,
    compact,
    sideChatId,
    sessionId,
    webSearchEnabled,
  });

  const { theme, sideChatPrefill, clearSideChatPrefill } = useUiStore();
  const t = getTheme(theme);

  const bottomRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const autoScrollRef = useRef(true);

  useEffect(() => {
    if (autoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: isStreaming ? "smooth" : "instant" });
    }
  }, [messages]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      autoScrollRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const onSend = (text, images) => {
    autoScrollRef.current = true;
    handleSend(text, images);
  };

  const px = compact ? "12px" : "20px";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg)",
        position: "relative",
      }}
    >
      {/* Pane header */}
      <div
        style={{
          padding: `10px ${px}`,
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
          background: "var(--bg-alt)",
        }}
      >
        <span
          style={{
            fontFamily: "'Geist', sans-serif",
            fontSize: compact ? "10px" : "11px",
            fontWeight: "600",
            color: "var(--text-faint)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          {label}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={() => setWebSearchEnabled((v) => !v)}
            title={webSearchEnabled ? "Web search on" : "Web search off"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: compact ? "3px 7px" : "4px 9px",
              background: webSearchEnabled ? t.accentSubtle : "transparent",
              border: "1px solid " + (webSearchEnabled ? t.accent : "var(--border)"),
              borderRadius: "5px",
              color: webSearchEnabled ? t.accent : "var(--text-faint)",
              fontSize: compact ? "10px" : "11px",
              fontFamily: "'JetBrains Mono', monospace",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            web
          </button>
          <ModelPicker model={model} setModel={setModel} compact={compact} />
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          padding: compact ? "16px 14px" : "24px 20px",
          scrollbarWidth: "thin",
          scrollbarColor: "var(--scrollbar) transparent",
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              opacity: 0.25,
            }}
          >
            <div
              style={{
                width: compact ? "28px" : "36px",
                height: compact ? "28px" : "36px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, #a78bfa22, #60a5fa22)",
                border: "1px solid #a78bfa33",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: compact ? "8px" : "10px",
                  height: compact ? "8px" : "10px",
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #a78bfa, #60a5fa)",
                }}
              />
            </div>
            <span
              style={{
                fontFamily: "'Geist', sans-serif",
                fontSize: compact ? "11px" : "12px",
                color: t.accentDim,
              }}
            >
              {placeholder}
            </span>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} showAskInSideChat={!isSideChat} />
        ))}

        {error && (
          <div
            style={{
              padding: "10px 14px",
              background: "var(--error-bg)",
              border: "1px solid var(--error-border)",
              borderRadius: "6px",
              color: "var(--status-err)",
              fontSize: "12px",
              fontFamily: "'JetBrains Mono', monospace",
              marginBottom: "12px",
            }}
          >
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <InputArea
        onSend={onSend}
        isStreaming={isStreaming}
        onStop={stopStreaming}
        compact={compact}
        placeholder={placeholder}
        prefill={isSideChat ? sideChatPrefill : null}
        onPrefillApplied={isSideChat ? clearSideChatPrefill : null}
      />
    </div>
  );
}
