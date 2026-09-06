import { useRef, useEffect, useState, useCallback } from "react";
import MessageBubble from "./MessageBubble";
import ModelPicker from "./ModelPicker";
import InputArea from "./InputArea";
import { useStreamingChat } from "../hooks/useStreamingChat";
import { useUiStore } from "../store/uiStore";
import { useSettingsStore } from "../store/settingsStore";
import { useSessionStore } from "../store/sessionStore";
import { Trash2, Check, X, GitBranch } from "lucide-react";
import styles from "./ChatPane.module.css";

// Ollama cloud models carry a `cloud` tag suffix (e.g. `minimax-m3:cloud`,
// `gpt-oss:120b-cloud`); local models don't.
const isCloudModel = (m) => /(?::|-)cloud$/.test(m || "");

export default function ChatPane({
  store,
  contextStore,
  sideChatId,
  sessionId,
  onBranch,
  placeholder = "Ask anything…",
  compact = false,
  isSideChat = false,
  isActive = true,
  label = "Chat",
}) {
  // `store` is always a Zustand hook (useMainChat for the main pane, a side
  // chat store for side panes). Use selectors so each piece of state gets its
  // own subscription — changes to abortController or isStreaming won't
  // re-render the whole pane.
  const messages = store((s) => s.messages);
  const model = store((s) => s.model);
  const setModel = store((s) => s.setModel);
  const focusNonce = store((s) => s.focusNonce);
  const chatNonce = store((s) => s.chatNonce);

  // Seed the per-pane web search toggle from the user's default. Re-derives on
  // each new chat or loaded session (chatNonce bump) so the toggle doesn't
  // carry over from the previous chat; within a chat the user's manual toggle
  // wins. Gated on `hydrated` since the default comes from settings.
  const webSearchDefault = useSettingsStore((s) => s.webSearchDefault);
  const settingsHydrated = useSettingsStore((s) => s.hydrated);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const webSearchTouchedRef = useRef(false);
  const prevWebNonceRef = useRef(chatNonce);
  useEffect(() => {
    if (chatNonce !== prevWebNonceRef.current) {
      prevWebNonceRef.current = chatNonce;
      webSearchTouchedRef.current = false;
    }
    if (!settingsHydrated) return;
    if (webSearchTouchedRef.current) return;
    setWebSearchEnabled(useSettingsStore.getState().webSearchDefault);
  }, [settingsHydrated, chatNonce]);

  // Thinking defaults on for cloud models (which reason quickly) and off for
  // local models (where the extra reasoning pass is slow). Each new chat or
  // loaded session (chatNonce bump) re-derives from the model and drops the
  // manual override; within a chat the user's toggle wins.
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const thinkingTouchedRef = useRef(false);
  const prevNonceRef = useRef(chatNonce);
  useEffect(() => {
    if (chatNonce !== prevNonceRef.current) {
      prevNonceRef.current = chatNonce;
      thinkingTouchedRef.current = false;
    }
    if (thinkingTouchedRef.current) return;
    setThinkingEnabled(isCloudModel(model));
  }, [model, chatNonce]);
  const { handleSend, resend, isStreaming, stopStreaming, error } =
    useStreamingChat({
      store,
      contextStore,
      compact,
      sideChatId,
      sessionId,
      webSearchEnabled,
      thinkingEnabled,
    });

  const { sideChatPrefill, clearSideChatPrefill } = useUiStore();
  const removeSideChat = useSessionStore((s) => s.removeSideChat);

  // Two-step delete confirm for side chats (mirrors the Sidebar row pattern).
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  useEffect(() => {
    if (!deleteConfirming) return;
    const id = setTimeout(() => setDeleteConfirming(false), 3000);
    return () => clearTimeout(id);
  }, [deleteConfirming]);

  const [autoScrollEnabled, setAutoScrollEnabled] = useState(false);
  const scrollContainerRef = useRef(null);
  const nearBottomRef = useRef(true);
  const justSentRef = useRef(false);
  // Tracks previous messages count. A jump in length (loading a session,
  // re-sending) signals "new content was added" — distinct from streaming
  // token updates that grow `content` in place. We use this to scroll to
  // the bottom when opening an existing session.
  const prevMessagesCountRef = useRef(0);

  useEffect(() => {
    const prev = prevMessagesCountRef.current;
    const grew = messages.length > prev;
    prevMessagesCountRef.current = messages.length;

    if (
      grew ||
      (autoScrollEnabled && nearBottomRef.current) ||
      justSentRef.current
    ) {
      justSentRef.current = false;
      // Scroll on next frame so the new message is mounted and the container
      // has the new scrollHeight.
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop =
            scrollContainerRef.current.scrollHeight;
        }
      });
    }
  }, [messages, autoScrollEnabled]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      nearBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const toggleAutoScroll = () => {
    setAutoScrollEnabled((v) => {
      if (!v && scrollContainerRef.current) {
        nearBottomRef.current = true;
        scrollContainerRef.current.scrollTop =
          scrollContainerRef.current.scrollHeight;
      }
      return !v;
    });
  };

  const onSend = useCallback(
    (text, images) => {
      justSentRef.current = true;
      handleSend(text, images);
    },
    [handleSend],
  );

  return (
    <div className={styles.pane}>
      {/* Pane header */}
      <div
        className={`${styles.header} ${compact ? styles.headerCompact : ""}`}
      >
        <div className={styles.headerTitle}>
          <span
            className={`${styles.headerLabel} ${compact ? styles.headerLabelCompact : ""}`}
          >
            {label}
          </span>
          {isSideChat && sideChatId && onBranch && (
            <button
              onClick={onBranch}
              aria-label="Branch a new side chat from this one"
              title="Branch a new side chat from this one"
              className={styles.branchBtn}
            >
              <GitBranch size={13} />
            </button>
          )}
          {isSideChat &&
            sideChatId &&
            (deleteConfirming ? (
              <>
                <button
                  onClick={() => removeSideChat(sessionId, sideChatId)}
                  aria-label="Confirm delete side chat"
                  title="Confirm delete"
                  className={`${styles.deleteBtn} ${styles.deleteBtnDanger}`}
                >
                  <Check size={13} />
                </button>
                <button
                  onClick={() => setDeleteConfirming(false)}
                  aria-label="Cancel delete"
                  title="Cancel"
                  className={styles.deleteBtn}
                >
                  <X size={13} />
                </button>
              </>
            ) : (
              <button
                onClick={() => setDeleteConfirming(true)}
                aria-label="Delete side chat"
                title="Delete side chat"
                className={styles.deleteBtn}
              >
                <Trash2 size={13} />
              </button>
            ))}
        </div>
        <div className={styles.headerActions}>
          <button
            onClick={() => {
              // Block turning web search on when the Ollama backend is
              // selected but has no key — surface the banner instead of
              // letting the model fire a doomed search. (The renderer only
              // sees the settings key, not the OLLAMA_API_KEY env-var
              // fallback, but that path is dev-only and unreliable anyway.)
              if (!webSearchEnabled) {
                const { searchProvider, ollamaApiKey } =
                  useSettingsStore.getState();
                if (searchProvider === "ollama" && !ollamaApiKey.trim()) {
                  useUiStore
                    .getState()
                    .setWebSearchNotice(
                      "Ollama web search needs an API key. Add one in Settings → Web search, or switch to DuckDuckGo.",
                    );
                  return;
                }
              }
              webSearchTouchedRef.current = true;
              setWebSearchEnabled((v) => !v);
            }}
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
          </button>
          <button
            onClick={() => {
              thinkingTouchedRef.current = true;
              setThinkingEnabled((v) => !v);
            }}
            title={thinkingEnabled ? "Thinking on" : "Thinking off"}
            className={`${styles.headerBtn} ${compact ? styles.headerBtnCompact : ""} ${thinkingEnabled ? styles.webBtnActive : ""}`}
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
              <path d="M9.5 2A6.5 6.5 0 0 0 4 12a5 5 0 0 0 2 4v3a1 1 0 0 0 1 1h2" />
              <path d="M14.5 2A6.5 6.5 0 0 1 20 12a5 5 0 0 1-2 4v3a1 1 0 0 1-1 1h-2" />
              <line x1="9" y1="22" x2="15" y2="22" />
              <line x1="12" y1="2" x2="12" y2="16" />
            </svg>
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
            showAskInSideChat={true}
            parentSideChatId={isSideChat ? sideChatId : null}
            onResend={isStreaming ? null : resend}
            onFollowUp={isStreaming ? null : onSend}
          />
        ))}

        {error && <div className={styles.errorBox}>{error}</div>}
      </div>

      <InputArea
        onSend={onSend}
        isStreaming={isStreaming}
        onStop={stopStreaming}
        compact={compact}
        placeholder={placeholder}
        prefill={isSideChat && isActive ? sideChatPrefill : null}
        onPrefillApplied={isSideChat && isActive ? clearSideChatPrefill : null}
        autoScrollEnabled={autoScrollEnabled}
        onToggleAutoScroll={toggleAutoScroll}
        focusNonce={focusNonce}
        autoFocus={isSideChat}
      />
    </div>
  );
}
