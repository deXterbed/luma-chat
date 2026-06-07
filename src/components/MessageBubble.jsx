import { useRef, useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { MessageSquarePlus } from "lucide-react";
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

export default function MessageBubble({ message, showAskInSideChat = false }) {
  const isUser = message.role === "user";
  const isStreaming = message.isStreaming;
  const { theme, setSideChatOpen, setSideChatPrefill } = useUiStore();
  const t = getTheme(theme);

  const [selectionMenu, setSelectionMenu] = useState(null); // { text, x, y }
  const menuRef = useRef(null);

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
    const quoted = selectionMenu.text
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
            onMouseEnter={(e) => (e.currentTarget.style.background = t.surfaceHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
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
        style={{
          padding: isUser ? "10px 14px" : "12px 16px",
          borderRadius: isUser ? "12px 12px 2px 12px" : "2px 12px 12px 12px",
          background: isUser ? t.userBubble : t.assistantBubble,
          border: isUser
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
        }}
      >
        {isUser ? (
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
                  const isBlock = String(children).includes("\n") || !!className;
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
