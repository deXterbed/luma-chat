import { useState } from "react";
import styles from "./ToolActivity.module.css";

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

function ToolArg({ name, args }) {
  const text = summarizeArgs(name, args);
  if (name === "web_fetch" && text.startsWith("http")) {
    return (
      <a
        href={text}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.toolArg}
      >
        {text}
      </a>
    );
  }
  return <span className={styles.toolArg}>{text}</span>;
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

export default function ToolActivity({ toolCalls, isStreaming }) {
  const [expanded, setExpanded] = useState(false);
  if (!toolCalls || toolCalls.length === 0) return null;

  const doneCount = toolCalls.filter((tc) => tc.status === "done").length;
  const errorCount = toolCalls.filter((tc) => tc.status === "error").length;
  const allDone = !isStreaming && doneCount + errorCount === toolCalls.length;

  if (allDone) {
    return (
      <div className={styles.section}>
        <button
          onClick={() => setExpanded((v) => !v)}
          className={styles.toggleBtn}
        >
          🔧 Used {toolCalls.length} tool{toolCalls.length === 1 ? "" : "s"}
          {errorCount > 0 &&
            ` (${errorCount} error${errorCount === 1 ? "" : "s"})`}
          <span style={{ marginLeft: "2px" }}>{expanded ? "▴" : "▾"}</span>
        </button>
        {expanded && (
          <div className={styles.expandedList}>
            {toolCalls.map((tc) => {
              const meta = TOOL_META[tc.name] || { icon: "🔧", label: tc.name };
              return (
                <div key={tc.id} className={styles.toolRow}>
                  <span className={styles.statusIcon}>
                    {tc.status === "error" ? "❌" : "✓"}
                  </span>
                  <span className={styles.toolLabel}>
                    {meta.icon} {meta.label}:
                  </span>
                  <ToolArg name={tc.name} args={tc.args} />
                  {extractHttpStatus(tc) && (
                    <span className={styles.httpStatus}>
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
    <div className={styles.section}>
      {toolCalls.map((tc) => {
        const meta = TOOL_META[tc.name] || { icon: "🔧", label: tc.name };
        const statusIcon =
          tc.status === "pending" ? "⏳" : tc.status === "error" ? "❌" : "✓";
        return (
          <div
            key={tc.id}
            className={`${styles.toolRow} ${tc.status === "pending" ? styles.toolRowPending : ""}`}
          >
            <span className={styles.statusIcon}>{statusIcon}</span>
            <span>
              {meta.icon} {meta.label}:
            </span>
            <ToolArg name={tc.name} args={tc.args} />
            {extractHttpStatus(tc) && (
              <span className={styles.httpStatus}>
                [{extractHttpStatus(tc)}]
              </span>
            )}
            {tc.status === "pending" && (
              <span className={styles.runningLabel}>running…</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
