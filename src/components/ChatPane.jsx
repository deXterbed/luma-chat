import { useRef, useEffect, useState } from "react";
import MessageBubble from "./MessageBubble";
import ModelPicker from "./ModelPicker";
import InputArea from "./InputArea";
import { useStreamingChat } from "../hooks/useStreamingChat";
import { useUiStore } from "../store/uiStore";
import { useSettingsStore } from "../store/settingsStore";
import { useSessionStore } from "../store/sessionStore";
import {
  useMainChat,
  getSideChatStore,
  deleteSideChatStore,
} from "../store/chatStore";
import { Trash2 } from "lucide-react";
import styles from "./ChatPane.module.css";

export default function ChatPane({
  store,
  contextStore,
  sideChatId,
  sessionId,
  placeholder = "Ask anything…",
  compact = false,
  isSideChat = false,
  isActive = true,
  label = "Chat",
}) {
  // For the main pane, use the global store directly to ensure proper subscription
  const mainState = useMainChat();
  const { messages, model, setModel } = isSideChat ? store() : mainState;
  // Seed the per-pane web search toggle from the user's default. The
  // setting might not be hydrated yet on first render, so we also watch
  // `hydrated` and apply the default once — but only if the user hasn't
  // already toggled the button (we don't clobber their override).
  const webSearchDefault = useSettingsStore((s) => s.webSearchDefault);
  const settingsHydrated = useSettingsStore((s) => s.hydrated);
  const [webSearchEnabled, setWebSearchEnabled] = useState(webSearchDefault);
  const webSearchAppliedRef = useRef(webSearchDefault);
  useEffect(() => {
    if (webSearchAppliedRef.current) return;
    if (!settingsHydrated) return;
    webSearchAppliedRef.current = true;
    setWebSearchEnabled(useSettingsStore.getState().webSearchDefault);
  }, [settingsHydrated]);
  const { handleSend, resend, isStreaming, stopStreaming, error } =
    useStreamingChat({
      store,
      contextStore,
      compact,
      sideChatId,
      sessionId,
      webSearchEnabled,
    });

  const { sideChatPrefill, clearSideChatPrefill } = useUiStore();

  const bottomRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const autoScrollRef = useRef(true);

  useEffect(() => {
    if (autoScrollRef.current) {
      bottomRef.current?.scrollIntoView({
        behavior: isStreaming ? "smooth" : "instant",
      });
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

  return (
    <div className={styles.pane}>
      {/* Pane header */}
      <div
        className={`${styles.header} ${compact ? styles.headerCompact : ""}`}
      >
        <span
          className={`${styles.headerLabel} ${compact ? styles.headerLabelCompact : ""}`}
        >
          {label}
        </span>
        <div className={styles.headerActions}>
          <button
            onClick={() => setWebSearchEnabled((v) => !v)}
            title={webSearchEnabled ? "Web search on" : "Web search off"}
            className={`${styles.headerBtn} ${compact ? styles.headerBtnCompact : ""} ${webSearchEnabled ? styles.webBtnActive : ""}`}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            web
          </button>
          <ModelPicker model={model} setModel={setModel} compact={compact} />
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        className={`${styles.messages} ${compact ? styles.messagesCompact : ""}`}
      >
        {messages.length === 0 && (
          <div className={styles.emptyState}>
            <div
              className={`${styles.emptyDotOuter} ${compact ? styles.emptyDotOuterCompact : ""}`}
            >
              <div
                className={`${styles.emptyDotInner} ${compact ? styles.emptyDotInnerCompact : ""}`}
              />
            </div>
            <span
              className={`${styles.emptyText} ${compact ? styles.emptyTextCompact : ""}`}
            >
              {placeholder}
            </span>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            showAskInSideChat={!isSideChat}
            onResend={isStreaming ? null : resend}
          />
        ))}

        {error && <div className={styles.errorBox}>{error}</div>}

        <div ref={bottomRef} />
      </div>

      <InputArea
        onSend={onSend}
        isStreaming={isStreaming}
        onStop={stopStreaming}
        compact={compact}
        placeholder={placeholder}
        prefill={isSideChat && isActive ? sideChatPrefill : null}
        onPrefillApplied={isSideChat && isActive ? clearSideChatPrefill : null}
      />
    </div>
  );
}
