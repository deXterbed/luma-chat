import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAppStore } from "../store/appStore";
import { getTheme } from "../theme";

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

// Map tool names to a human label and an icon. Keep this list small —
// only the tools we actually ship.
const TOOL_META = {
  web_search: { icon: "🔍", label: "Searched", argKey: "query" },
  web_fetch: { icon: "📄", label: "Read", argKey: "url" },
  get_current_time: { icon: "🕐", label: "Got time", argKey: "timezone" },
};

function summarizeArgs(name, args) {
  const meta = TOOL_META[name];
  if (!meta) return JSON.stringify(args);
  const v = args?.[meta.argKey];
  if (!v) return "";
  // Truncate long URLs / queries for display
  const max = 60;
  return v.length > max ? v.slice(0, max) + "…" : v;
}

function ToolActivity({ toolCalls, t, isStreaming }) {
  const [expanded, setExpanded] = useState(false);
  if (!toolCalls || toolCalls.length === 0) return null;

  const doneCount = toolCalls.filter((tc) => tc.status === "done").length;
  const errorCount = toolCalls.filter((tc) => tc.status === "error").length;
  const allDone = !isStreaming && doneCount + errorCount === toolCalls.length;

  // After streaming, show a single collapsible summary line.
  if (allDone) {
    return (
      <div
        style={{
          marginTop: "10px",
          paddingTop: "8px",
          borderTop: "1px solid " + t.border,
          fontSize: "10px",
          color: t.textFaint,
          fontFamily: "'Geist', sans-serif",
        }}
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            color: t.textFaint,
            fontSize: "10px",
            fontFamily: "'Geist', sans-serif",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          🔧 Used {toolCalls.length} tool{toolCalls.length === 1 ? "" : "s"}
          {errorCount > 0 &&
            ` (${errorCount} error${errorCount === 1 ? "" : "s"})`}
          <span style={{ marginLeft: "2px" }}>{expanded ? "▴" : "▾"}</span>
        </button>
        {expanded && (
          <div style={{ marginTop: "6px" }}>
            {toolCalls.map((tc) => {
              const meta = TOOL_META[tc.name] || { icon: "🔧", label: tc.name };
              return (
                <div
                  key={tc.id}
                  style={{
                    display: "flex",
                    gap: "6px",
                    alignItems: "baseline",
                    padding: "2px 0",
                    color: t.textFaint,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "10px",
                  }}
                >
                  <span style={{ flexShrink: 0 }}>
                    {tc.status === "error" ? "❌" : "✓"}
                  </span>
                  <span style={{ color: t.textMuted }}>
                    {meta.icon} {meta.label}:
                  </span>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {summarizeArgs(tc.name, tc.args)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // During streaming: show a live list of all tool calls (in-flight + done).
  return (
    <div
      style={{
        marginTop: "10px",
        paddingTop: "8px",
        borderTop: "1px solid " + t.border,
        fontSize: "10px",
        color: t.textFaint,
        fontFamily: "'Geist', sans-serif",
      }}
    >
      {toolCalls.map((tc) => {
        const meta = TOOL_META[tc.name] || { icon: "🔧", label: tc.name };
        const argSummary = summarizeArgs(tc.name, tc.args);
        const statusIcon =
          tc.status === "pending" ? "⏳" : tc.status === "error" ? "❌" : "✓";
        const statusColor = tc.status === "pending" ? t.accent : t.textFaint;
        return (
          <div
            key={tc.id}
            style={{
              display: "flex",
              gap: "6px",
              alignItems: "baseline",
              padding: "2px 0",
              color: statusColor,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "10px",
            }}
          >
            <span style={{ flexShrink: 0 }}>{statusIcon}</span>
            <span>
              {meta.icon} {meta.label}:
            </span>
            <span
              style={{
                color: t.textFaint,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {argSummary}
            </span>
            {tc.status === "pending" && (
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: "9px",
                  color: t.textFaint,
                  fontFamily: "'Geist', sans-serif",
                }}
              >
                running…
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function MessageBubble({ message }) {
  const isUser = message.role === "user";
  const isStreaming = message.isStreaming;
  const theme = useAppStore((s) => s.theme);
  const t = getTheme(theme);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        marginBottom: "16px",
        animation: "fadeSlideIn 0.2s ease-out",
      }}
    >
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
          maxWidth: "85%",
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
        }}
      >
        {isUser ? (
          <span
            style={{
              whiteSpace: "pre-wrap",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {message.content}
          </span>
        ) : (
          <div
            className="markdown-body"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ inline, className, children, ...props }) {
                  return inline ? (
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
                  ) : (
                    <pre
                      style={{
                        background: t.preBg,
                        border: "1px solid " + t.preBorder,
                        borderRadius: "6px",
                        padding: "12px",
                        overflowX: "auto",
                        margin: "8px 0",
                      }}
                    >
                      <code
                        style={{
                          fontSize: "12px",
                          color: t.preText,
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                        {...props}
                      >
                        {children}
                      </code>
                    </pre>
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
