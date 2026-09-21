import { useRef, useEffect, useState, useCallback } from "react";
import MessageBubble from "./MessageBubble";
import ModelPicker from "./ModelPicker";
import InputArea from "./InputArea";
import { useStreamingChat } from "../hooks/useStreamingChat";
import { useUiStore } from "../store/uiStore";
import { useSettingsStore } from "../store/settingsStore";
import { useSessionStore } from "../store/sessionStore";
import { db } from "../lib/db";
import { isCloudModel, isModelUnavailable, loadModelWindow } from "../lib/modelContext";
import { Trash2, Check, X, GitBranch, FolderOpen, FolderPlus, FolderMinus } from "lucide-react";
import styles from "./ChatPane.module.css";

// The folder's basename, for display. Never the absolute path — that leaks the
// username into screenshots, and this app ships screenshots in its README.
const folderName = (path) => (path || "").split(/[\\/]/).filter(Boolean).pop() || path;

// An empty value or a loopback host means the model runs on this machine, so
// nothing read from the project leaves it.
function isLocalOllama(url) {
  if (!url || !url.trim()) return true;
  try {
    const host = new URL(url.includes("://") ? url : `http://${url}`).hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "0.0.0.0"
    );
  } catch {
    return false;
  }
}

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

  // ── Codebase mode: the attached project folder ──
  //
  // Mode is derived, not toggled: the roots *are* the switch, so attaching
  // exposes the read-only file tools and detaching returns the pane to ordinary
  // chat. The pane's own roots are the live value (a folder can be attached
  // before the session row exists); a side chat never sets any of its own, so it
  // reads its session's. This is the same derivation `useStreamingChat` makes,
  // and it has to match — the web-search default below keys off it.
  const projectRoots = store((s) => s.projectRoots);
  const sessionRoots = useSessionStore(
    (s) => s.chatSessions.find((c) => c.id === sessionId)?.projectRoots,
  );
  const codebase = projectRoots.length > 0 || (sessionRoots?.length ?? 0) > 0;

  // Seed the per-pane web search toggle from the user's default. Re-derives on
  // each new chat or loaded session (chatNonce bump) so the toggle doesn't
  // carry over from the previous chat; within a chat the user's manual toggle
  // wins. Gated on `hydrated` since the default comes from settings.
  const webSearchDefault = useSettingsStore((s) => s.webSearchDefault);
  const settingsHydrated = useSettingsStore((s) => s.hydrated);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const webSearchTouchedRef = useRef(false);
  const prevWebNonceRef = useRef(chatNonce);
  const prevCodebaseRef = useRef(codebase);
  useEffect(() => {
    if (chatNonce !== prevWebNonceRef.current) {
      prevWebNonceRef.current = chatNonce;
      webSearchTouchedRef.current = false;
    }
    // Attaching a folder is the moment file reads and web access start sharing a
    // context, which is Luma's egress pair: a fetched page can order a file read,
    // and a file's contents can leave inside a URL. So off is the *default* in
    // Codebase mode, and turning it back on there is a deliberate act.
    if (codebase !== prevCodebaseRef.current) {
      prevCodebaseRef.current = codebase;
      webSearchTouchedRef.current = false;
    }
    if (!settingsHydrated) return;
    if (webSearchTouchedRef.current) return;
    setWebSearchEnabled(codebase ? false : useSettingsStore.getState().webSearchDefault);
  }, [settingsHydrated, chatNonce, codebase]);

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

  // A model can vanish from the server (renamed, retired, or never pulled) while
  // a saved session still points at it — and since the picker lists only what
  // the server reports, it would be absent from the menu with nothing to explain
  // why. Warn rather than auto-switch; see `isModelUnavailable`.
  const availableModels = useUiStore((s) => s.availableModels);
  const customModels = useUiStore((s) => s.customModels);
  const ollamaConnected = useUiStore((s) => s.ollamaConnected);
  const modelUnavailable = isModelUnavailable({
    model,
    available: availableModels,
    custom: customModels,
    connected: ollamaConnected,
  });

  // Attach/detach and the remote-server notice. The derived roots live above,
  // because the web-search default keys off them. Side chats have no control of
  // their own — they inherit the session's roots.
  const setPaneProjectRoots = store((s) => s.setProjectRoots);
  const setSessionProjectRoots = useSessionStore((s) => s.setProjectRoots);
  const projectRemoteNoticeAck = useSettingsStore(
    (s) => s.projectRemoteNoticeAck,
  );
  const [projectNotice, setProjectNotice] = useState(null);
  const [attachError, setAttachError] = useState(null);
  // Roots restored from a backup may point at folders that aren't on this
  // machine. The same command that gates attaching answers "does it exist", so
  // each chip can say so without a second existence check that could disagree.
  const [missingRoots, setMissingRoots] = useState([]);

  useEffect(() => {
    if (projectRoots.length === 0) {
      setMissingRoots([]);
      return;
    }
    let cancelled = false;
    // Every root, not just the first: a restored session can lose any of them,
    // and each chip reports on itself.
    Promise.all(
      projectRoots.map((root) =>
        db.validateProjectRoot(root).then(
          () => null,
          () => root,
        ),
      ),
    ).then((results) => {
      if (!cancelled) setMissingRoots(results.filter(Boolean));
    });
    return () => {
      cancelled = true;
    };
  }, [projectRoots]);

  // Attaching *appends*: a second folder is an addition to the root set, not a
  // replacement for it. The picker allows a multi-select, so one trip can add
  // several at once.
  const handleAttachProject = async () => {
    setAttachError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ directory: true, multiple: true });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      // Rust owns the validation (exists, is a directory, not `/`, not $HOME,
      // not Luma's own data dir) and returns the canonical path to store. One
      // bad pick in a multi-select must not discard the good ones, so failures
      // are collected and reported rather than thrown.
      const added = [];
      const failed = [];
      for (const path of paths) {
        try {
          const canonical = await db.validateProjectRoot(path);
          if (!canonical) {
            failed.push(`${folderName(path)} (attaching a folder needs the desktop app)`);
          } else if (
            !projectRoots.includes(canonical) &&
            !added.includes(canonical)
          ) {
            added.push(canonical);
          }
        } catch (err) {
          failed.push(`${folderName(path)} — ${err?.message || err}`);
        }
      }
      if (failed.length > 0) {
        setAttachError(`Not attached: ${failed.join("; ")}`);
      }
      if (added.length === 0) return;
      const roots = [...projectRoots, ...added];
      setPaneProjectRoots(roots);
      if (sessionId) setSessionProjectRoots(sessionId, roots);
      const { ollamaUrl } = useSettingsStore.getState();
      if (!isLocalOllama(ollamaUrl) && !projectRemoteNoticeAck) {
        setProjectNotice(
          "Files Luma reads go to your Ollama server, not just to this machine. Read-only, but not private.",
        );
        useSettingsStore.getState().ackProjectRemoteNotice();
      }
    } catch (err) {
      setAttachError(err?.message || String(err));
    }
  };

  // One folder at a time: each chip carries its own detach, so removing one
  // never silently drops the others. Emptying the set is what leaves Codebase
  // mode, since the roots *are* the mode.
  const handleDetachProject = (root) => {
    setAttachError(null);
    setProjectNotice(null);
    const roots = projectRoots.filter((r) => r !== root);
    setPaneProjectRoots(roots);
    if (sessionId) setSessionProjectRoots(sessionId, roots);
  };

  // Codebase mode needs the model's real context window to size itself, and
  // reading it is a round trip — so warm it here, on attach and on model change,
  // rather than making the first message wait. `useStreamingChat` reads the
  // cached value synchronously and falls back to the setting until it lands.
  useEffect(() => {
    if (projectRoots.length === 0 || !model) return;
    loadModelWindow(model);
  }, [projectRoots, model]);

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
          {!isSideChat && (
            <div className={styles.projectChips}>
              {projectRoots.map((root) => {
                const missing = missingRoots.includes(root);
                return (
                  <span
                    key={root}
                    className={`${styles.projectChip} ${missing ? styles.projectChipMissing : ""}`}
                    title={
                      missing
                        ? `${root} — this folder is no longer there`
                        : `${root} (read-only)`
                    }
                  >
                    <FolderOpen size={11} />
                    <span className={styles.projectName}>
                      {folderName(root)}
                      {missing ? " (missing)" : ""}
                    </span>
                    <button
                      onClick={() => handleDetachProject(root)}
                      aria-label={`Detach ${folderName(root)}`}
                      title={`Detach ${folderName(root)}`}
                      className={styles.projectDetach}
                    >
                      <FolderMinus size={11} />
                    </button>
                  </span>
                );
              })}
              <button
                onClick={handleAttachProject}
                aria-label={
                  projectRoots.length > 0
                    ? "Add another project folder"
                    : "Attach a project folder"
                }
                title={
                  projectRoots.length > 0
                    ? "Add another project folder (read-only)"
                    : "Attach a project folder (read-only)"
                }
                className={`${styles.headerBtn} ${compact ? styles.headerBtnCompact : ""}`}
              >
                {projectRoots.length > 0 ? (
                  <FolderPlus size={11} />
                ) : (
                  <FolderOpen size={11} />
                )}
              </button>
            </div>
          )}
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

      {/* Codebase mode notice + attach errors. Both are per-pane and transient:
          the notice is acknowledged once (settings), so it doesn't nag. */}
      {modelUnavailable && (
        <div className={`${styles.paneNotice} ${styles.paneNoticeWarn}`}>
          <span>
            <strong>{model}</strong> isn't available on this Ollama server — it
            may have been renamed or removed. Pick another model to continue;
            this chat's history is unaffected.
          </span>
        </div>
      )}
      {projectNotice && (
        <div className={styles.paneNotice}>
          <span>{projectNotice}</span>
          <button
            onClick={() => setProjectNotice(null)}
            aria-label="Dismiss notice"
            className={styles.paneNoticeDismiss}
          >
            <X size={12} />
          </button>
        </div>
      )}
      {attachError && (
        <div className={styles.paneNotice}>
          <span>{attachError}</span>
          <button
            onClick={() => setAttachError(null)}
            aria-label="Dismiss"
            className={styles.paneNoticeDismiss}
          >
            <X size={12} />
          </button>
        </div>
      )}

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
