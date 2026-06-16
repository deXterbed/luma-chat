import { useRef, useState, useEffect, useLayoutEffect, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { MessageSquarePlus, X, CornerDownLeft } from "lucide-react";
import { useUiStore } from "../store/uiStore";
import { useSettingsStore } from "../store/settingsStore";
import { useSessionStore } from "../store/sessionStore";
import { useMainChat } from "../store/chatStore";
import { getTheme } from "../theme";
import ToolActivity from "./ToolActivity";
import styles from "./MessageBubble.module.css";

function StreamingCursor() {
  return <span className={styles.cursor} />;
}

const MessageBubble = memo(function MessageBubble({
  message,
  showAskInSideChat = false,
  onResend = null,
}) {
  const isUser = message.role === "user";
  const isStreaming = message.isStreaming;
  const { setSideChatOpen, setSideChatPrefill } = useUiStore();
  const theme = useSettingsStore((s) => s.theme);
  const t = getTheme(theme);

  const [editing, setEditing] = useState(false);
  const [editIsEmpty, setEditIsEmpty] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const menuRef = useRef(null);
  const editRef = useRef(null);
  const bubbleRef = useRef(null);
  const wrapperRef = useRef(null);
  const selectedTextRef = useRef("");
  const bubbleWidthRef = useRef(0);
  const editingRef = useRef(false);
  const cancelEditRef = useRef(null);

  useLayoutEffect(() => {
    if (bubbleRef.current)
      bubbleWidthRef.current = bubbleRef.current.offsetWidth;
  }, []);

  useEffect(() => {
    if (!bubbleRef.current) return;
    const ro = new ResizeObserver((entries) => {
      if (!editingRef.current) {
        bubbleWidthRef.current =
          entries[0]?.borderBoxSize?.[0]?.inlineSize ??
          bubbleRef.current?.offsetWidth ??
          0;
      }
    });
    ro.observe(bubbleRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  useEffect(() => {
    if (!editing || !editRef.current) return;
    const el = editRef.current;
    el.innerText = message.content;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }, [editing]);

  useEffect(() => {
    if (!editing) setDraft(message.content);
  }, [message.content, editing]);

  const startEdit = () => {
    if (bubbleRef.current && bubbleWidthRef.current) {
      bubbleRef.current.style.minWidth = bubbleWidthRef.current + "px";
    }
    setEditIsEmpty(!message.content.trim());
    setEditing(true);
  };

  const cancelEdit = () => {
    if (bubbleRef.current) bubbleRef.current.style.minWidth = "";
    setDraft(message.content);
    setEditing(false);
  };

  const submitEdit = () => {
    const text = (editRef.current?.innerText ?? draft).trim();
    if (!text) return;
    if (onResend) {
      if (bubbleRef.current) bubbleRef.current.style.minWidth = "";
      onResend(message.id, text);
      setEditing(false);
    }
  };

  const handleEditKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  };

  const handleMouseUp = () => {
    if (isUser || !showAskInSideChat) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
    const text = sel.toString().trim();
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    selectedTextRef.current = text;
    if (menuRef.current) {
      menuRef.current.style.left = rect.left + rect.width / 2 + "px";
      menuRef.current.style.top = rect.top - 8 + "px";
      menuRef.current.style.display = "flex";
    }
  };

  const hideMenu = () => {
    if (menuRef.current) menuRef.current.style.display = "none";
  };

  cancelEditRef.current = cancelEdit;

  useEffect(() => {
    const onMouseDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        hideMenu();
      }
      if (
        editingRef.current &&
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target)
      ) {
        cancelEditRef.current();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const handleAskInSideChat = () => {
    const quoted =
      selectedTextRef.current
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n") + "\n\n";
    hideMenu();
    // Always start a fresh side chat for the new question so the quoted text
    // doesn't land in the user's existing tab. The prefill flows into the
    // newly-active tab via ChatPane's existing sideChatPrefill wiring.
    const { activeChatId } = useSessionStore.getState();
    if (activeChatId) {
      const model = useMainChat.getState().model || undefined;
      useSessionStore.getState().addSideChat(activeChatId, model);
    }
    setSideChatOpen(true);
    setSideChatPrefill(quoted);
  };

  return (
    <div
      ref={wrapperRef}
      onMouseUp={handleMouseUp}
      className={`${styles.wrapper} ${isUser ? styles.wrapperUser : styles.wrapperAssistant}`}
    >
      <div ref={menuRef} className={styles.selectionPopup}>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleAskInSideChat}
          className={styles.popupBtn}
        >
          <MessageSquarePlus size={12} />
          Ask in side chat
        </button>
      </div>

      <div className={styles.roleLabel}>{isUser ? "you" : "assistant"}</div>

      {message.images && message.images.length > 0 && (
        <div
          className={`${styles.imageRow} ${isUser ? styles.imageRowUser : styles.imageRowAssistant}`}
        >
          {message.images.map((img, i) => (
            <img
              key={i}
              src={`data:image/jpeg;base64,${img}`}
              alt="attached"
              className={styles.attachedImg}
            />
          ))}
        </div>
      )}

      <div
        ref={bubbleRef}
        onClick={
          isUser && !editing && onResend && !isStreaming ? startEdit : undefined
        }
        className={`${styles.bubble} ${isUser ? styles.bubbleUser : ""}`}
      >
        {isUser && editing ? (
          <div
            ref={editRef}
            contentEditable
            suppressContentEditableWarning
            onKeyDown={handleEditKeyDown}
            onInput={(e) => setEditIsEmpty(!e.currentTarget.innerText.trim())}
            className={styles.editTextarea}
          />
        ) : isUser ? (
          <span className={styles.userText}>{message.content}</span>
        ) : (
          <div className={styles.markdownBody}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={{
                code({ className, children, ...props }) {
                  const isBlock =
                    String(children).includes("\n") || !!className;
                  return isBlock ? (
                    <pre
                      style={{
                        background: t.preBg,
                        border: "1px solid " + t.preBorder,
                        borderRadius: "6px",
                        padding: "12px",
                        overflowX: "auto",
                        margin: "8px 0",
                        width: "fit-content",
                        maxWidth: "100%",
                      }}
                    >
                      <code
                        style={{
                          fontSize: "12px",
                          color: t.preText,
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                        className={className}
                        {...props}
                      >
                        {children}
                      </code>
                    </pre>
                  ) : (
                    <code
                      style={{
                        background: t.codeBg,
                        border: "1px solid " + t.codeBorder,
                        borderRadius: "3px",
                        padding: "1px 5px",
                        fontSize: "12px",
                        color: t.codeText,
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                      {...props}
                    >
                      {children}
                    </code>
                  );
                },
                p({ children }) {
                  return (
                    <p style={{ margin: "0 0 8px", lineHeight: 1.65 }}>
                      {children}
                    </p>
                  );
                },
                ul({ children }) {
                  return (
                    <ul style={{ paddingLeft: "16px", margin: "6px 0" }}>
                      {children}
                    </ul>
                  );
                },
                li({ children }) {
                  return <li style={{ marginBottom: "4px" }}>{children}</li>;
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
            {isStreaming && <StreamingCursor />}
          </div>
        )}
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <ToolActivity
            toolCalls={message.toolCalls}
            isStreaming={isStreaming}
          />
        )}
      </div>

      {isUser && editing && (
        <div className={styles.editActions}>
          <button
            onClick={cancelEdit}
            aria-label="Cancel edit"
            title="Cancel"
            className={`${styles.editBtn} ${styles.editBtnCancel}`}
          >
            <X size={8} />
          </button>
          <button
            onClick={submitEdit}
            disabled={editIsEmpty}
            aria-label="Send edited message"
            title="Send"
            className={`${styles.editBtn} ${styles.editBtnSend} ${!editIsEmpty ? styles.editBtnSendActive : styles.editBtnSendDisabled}`}
          >
            <CornerDownLeft size={8} />
          </button>
        </div>
      )}
    </div>
  );
});

export default MessageBubble;
