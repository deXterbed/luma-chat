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
      </div>
    </div>
  );
}
