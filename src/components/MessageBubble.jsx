import { useRef, useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { MessageSquarePlus, X, CornerDownLeft } from "lucide-react";
import { useUiStore } from "../store/uiStore";
import { getTheme } from "../theme";
import ToolActivity from "./ToolActivity";

function StreamingCursor({ color }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: "2px",
        height: "14px",
        background: color,
        marginLeft: "2px",
        verticalAlign: "middle",
        animation: "blink 0.8s ease-in-out infinite",
      }}
    />
  );
}

export default function MessageBubble({
  message,
  showAskInSideChat = false,
  onResend = null,
}) {
  const isUser = message.role === "user";
  const isStreaming = message.isStreaming;
  const { theme, setSideChatOpen, setSideChatPrefill } = useUiStore();
  const t = getTheme(theme);

  const [selectionMenu, setSelectionMenu] = useState(null); // { text, x, y }
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const menuRef = useRef(null);
  const editRef = useRef(null);

  // Auto-resize the edit textarea like the main InputArea does.
  useEffect(() => {
    if (!editing || !editRef.current) return;
    const el = editRef.current;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
    el.focus();
    el.selectionStart = el.value.length;
    el.selectionEnd = el.value.length;
  }, [editing]);

  // Reset the draft if the message content changes externally (e.g. truncation).
  useEffect(() => {
    if (!editing) setDraft(message.content);
  }, [message.content, editing]);

  const startEdit = () => {
    setDraft(message.content);
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft(message.content);
    setEditing(false);
  };

  const submitEdit = () => {
    const text = draft.trim();
    if (!text) return;
    if (onResend) {
      onResend(message.id, text);
      // The store will truncate & re-stream; the parent re-renders this bubble
      // as a non-editing bubble for the new content, so the editing state
      // naturally clears once the messages array updates.
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
    setSelectionMenu({ text, x: rect.left + rect.width / 2, y: rect.top });
  };

  useEffect(() => {
    if (!selectionMenu) return;
    const onMouseDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setSelectionMenu(null);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [selectionMenu]);

  const handleAskInSideChat = () => {
    const quoted =
      selectionMenu.text
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n") + "\n\n";
    setSideChatOpen(true);
    setSideChatPrefill(quoted);
    setSelectionMenu(null);
  };

  return (
    <div
      onMouseUp={handleMouseUp}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        marginBottom: "16px",
        animation: "fadeSlideIn 0.2s ease-out",
        minWidth: 0,
        maxWidth: "100%",
        position: "relative",
      }}
    >
      {selectionMenu && (
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            left: selectionMenu.x,
            top: selectionMenu.y - 8,
            transform: "translate(-50%, -100%)",
            background: t.surface,
            border: "1px solid " + t.borderStrong,
            borderRadius: "6px",
            padding: "3px",
            display: "flex",
            zIndex: 1000,
            boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
          }}
        >
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleAskInSideChat}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              padding: "5px 10px",
              background: "transparent",
              border: "none",
              borderRadius: "4px",
              color: t.accent,
              fontSize: "11px",
              fontFamily: "'JetBrains Mono', monospace",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = t.surfaceHover)
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            <MessageSquarePlus size={12} />
            Ask in side chat
          </button>
        </div>
      )}
      {/* Role label */}
      <div
        style={{
          fontSize: "10px",
          color: t.textFaint,
          fontFamily: "'JetBrains Mono', monospace",
          marginBottom: "4px",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        {isUser ? "you" : "assistant"}
      </div>

      {/* Image previews */}
      {message.images && message.images.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: "6px",
            marginBottom: "6px",
            flexWrap: "wrap",
            justifyContent: isUser ? "flex-end" : "flex-start",
          }}
        >
          {message.images.map((img, i) => (
            <img
              key={i}
              src={`data:image/jpeg;base64,${img}`}
              alt="attached"
              style={{
                maxWidth: "160px",
                maxHeight: "120px",
                borderRadius: "6px",
                objectFit: "cover",
                border: "1px solid var(--border-strong)",
              }}
            />
          ))}
        </div>
      )}

      {/* Bubble */}
      <div
        onClick={
          isUser && !editing && onResend && !isStreaming ? startEdit : undefined
        }
        style={{
          padding: isUser && !editing ? "10px 14px" : "12px 16px",
          borderRadius: isUser ? "12px 12px 2px 12px" : "2px 12px 12px 12px",
          background: isUser && !editing ? t.userBubble : t.assistantBubble,
          border:
            isUser && !editing
              ? "1px solid " + t.userBubbleBorder
              : "1px solid " + t.assistantBubbleBorder,
          color: t.text,
          fontSize: "13px",
          lineHeight: 1.65,
          fontFamily: "'JetBrains Mono', monospace",
          minWidth: 0,
          maxWidth: isUser ? "85%" : "100%",
          overflowWrap: "break-word",
          wordBreak: "break-word",
          cursor:
            isUser && !editing && onResend && !isStreaming ? "text" : "default",
        }}
      >
        {isUser && editing ? (
          // Inline edit mode — textarea + X / ↩ buttons, no bubble chrome
          <div
            style={{
              padding: "10px 14px",
              background: t.userBubble,
              border: "1px solid " + t.userBubbleBorder,
              borderRadius: "12px 12px 2px 12px",
              color: t.text,
              fontSize: "13px",
              lineHeight: 1.65,
              fontFamily: "'JetBrains Mono', monospace",
              minWidth: "260px",
              maxWidth: "85%",
            }}
          >
            <textarea
              ref={editRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleEditKeyDown}
              rows={1}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                outline: "none",
                resize: "none",
                color: t.text,
                fontSize: "13px",
                fontFamily: "'JetBrains Mono', monospace",
                lineHeight: 1.65,
                overflowY: "hidden",
                padding: 0,
                margin: 0,
                caretColor: t.caretColor ?? t.accent,
              }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "4px",
                marginTop: "8px",
                paddingTop: "6px",
                borderTop: "1px solid " + t.border,
              }}
            >
              <button
                onClick={cancelEdit}
                aria-label="Cancel edit"
                title="Cancel"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "26px",
                  height: "26px",
                  background: "transparent",
                  border: "1px solid " + t.borderStrong,
                  borderRadius: "5px",
                  color: t.statusErr,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = t.surfaceHover;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <X size={13} />
              </button>
              <button
                onClick={submitEdit}
                disabled={!draft.trim()}
                aria-label="Send edited message"
                title="Send"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "26px",
                  height: "26px",
                  background: draft.trim()
                    ? (t.sendGradient ??
                      "linear-gradient(135deg, #7c3aed, #3b82f6)")
                    : (t.sendDisabled ?? "#1a1a22"),
                  border: "none",
                  borderRadius: "5px",
                  color: draft.trim() ? "#fff" : t.textFaint,
                  cursor: draft.trim() ? "pointer" : "default",
                  transition: "all 0.15s",
                }}
              >
                <CornerDownLeft size={13} />
              </button>
            </div>
          </div>
        ) : isUser ? (
          <span
            style={{
              whiteSpace: "pre-wrap",
              fontFamily: "'JetBrains Mono', monospace",
              display: "inline-block",
              maxWidth: "100%",
            }}
          >
            {message.content}
          </span>
        ) : (
          <div
            className="markdown-body"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={{
                code({ className, children, ...props }) {
                  // remark appends \n to fenced block code; inline code never has \n
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
            {isStreaming && <StreamingCursor color={t.accent} />}
          </div>
        )}
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <ToolActivity
            toolCalls={message.toolCalls}
            t={t}
            isStreaming={isStreaming}
          />
        )}
      </div>
    </div>
  );
}
