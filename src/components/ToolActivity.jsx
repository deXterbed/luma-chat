import { useState } from "react";

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
  const max = 60;
  return v.length > max ? v.slice(0, max) + "…" : v;
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
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
            <span style={{ color: t.textFaint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {summarizeArgs(tc.name, tc.args)}
            </span>
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
