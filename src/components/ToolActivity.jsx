import { useState } from "react";

const TOOL_META = {
  web_search: { icon: "🔍", label: "Searched", argKey: "query" },
  web_fetch: { icon: "📄", label: "Read", argKey: "url" },
  get_current_time: { icon: "🕐", label: "Got time", argKey: "timezone" },
};

function summarizeArgs(name, args) {
  const meta = TOOL_META[name];
  if (!meta) return JSON.stringify(args);
  return args?.[meta.argKey] ?? "";
}

function extractHttpStatus(tc) {
  if (tc.name !== "web_fetch") return null;
  if (tc.resultPreview) {
    try {
      const parsed = JSON.parse(tc.resultPreview);
      if (parsed.httpStatus) return parsed.httpStatus;
    } catch {}
  }
  if (tc.error) {
    const m = tc.error.match(/HTTP (\d{3})/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

export default function ToolActivity({ toolCalls, t, isStreaming }) {
  const [expanded, setExpanded] = useState(false);
  if (!toolCalls || toolCalls.length === 0) return null;

  const doneCount = toolCalls.filter((tc) => tc.status === "done").length;
  const errorCount = toolCalls.filter((tc) => tc.status === "error").length;
  const allDone = !isStreaming && doneCount + errorCount === toolCalls.length;

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
          {errorCount > 0 && ` (${errorCount} error${errorCount === 1 ? "" : "s"})`}
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
                  <span style={{ wordBreak: "break-all" }}>
                    {summarizeArgs(tc.name, tc.args)}
                  </span>
                  {extractHttpStatus(tc) && (
                    <span style={{ flexShrink: 0, opacity: 0.6 }}>
                      [{extractHttpStatus(tc)}]
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

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
        const statusIcon = tc.status === "pending" ? "⏳" : tc.status === "error" ? "❌" : "✓";
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
            <span>{meta.icon} {meta.label}:</span>
            <span style={{ color: t.textFaint, wordBreak: "break-all" }}>
              {summarizeArgs(tc.name, tc.args)}
            </span>
            {extractHttpStatus(tc) && (
              <span style={{ flexShrink: 0, color: t.textFaint, opacity: 0.6 }}>
                [{extractHttpStatus(tc)}]
              </span>
            )}
            {tc.status === "pending" && (
              <span style={{ marginLeft: "auto", fontSize: "9px", color: t.textFaint, fontFamily: "'Geist', sans-serif" }}>
                running…
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
