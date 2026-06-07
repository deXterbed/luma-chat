import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useUiStore } from "../store/uiStore";
import { getTheme } from "../theme";

const DEFAULT_MODELS = [
  "minimax-m3:cloud",
  "kimi-k2.6:cloud",
  "glm-5.1:cloud",
  "qwen3.5:cloud",
  "nemotron-3-super:cloud",
  "gemma4:31b-cloud",
  "gemma4",
  "qwen3.6",
];

export default function ModelPicker({ model, setModel, compact }) {
  const theme = useUiStore((s) => s.theme);
  const t = getTheme(theme);
  const [open, setOpen] = useState(false);
  const [customInput, setCustomInput] = useState("");

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border-strong)",
          borderRadius: "5px",
          padding: "4px 8px",
          color: "var(--accent-dim)",
          fontSize: "10px",
          fontFamily: "'JetBrains Mono', monospace",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "5px",
          transition: "all 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = t.textSubtle)}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = t.borderStrong)}
      >
        <span
          style={{
            maxWidth: compact ? "100px" : "160px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {model}
        </span>
        <ChevronDown size={9} />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: "4px",
            background: "var(--surface)",
            border: "1px solid var(--border-strong)",
            borderRadius: "7px",
            overflow: "hidden",
            zIndex: 100,
            minWidth: "200px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
        >
          {DEFAULT_MODELS.map((m) => (
            <button
              key={m}
              onClick={() => { setModel(m); setOpen(false); }}
              style={{
                width: "100%",
                padding: "8px 12px",
                background: m === model ? t.surfaceActive : "transparent",
                border: "none",
                color: m === model ? t.accent : t.textSubtle,
                fontSize: "11px",
                fontFamily: "'JetBrains Mono', monospace",
                cursor: "pointer",
                textAlign: "left",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => { if (m !== model) e.currentTarget.style.background = t.surface; }}
              onMouseLeave={(e) => { if (m !== model) e.currentTarget.style.background = "transparent"; }}
            >
              {m}
            </button>
          ))}
          <div style={{ borderTop: "1px solid var(--border)", padding: "6px 8px" }}>
            <input
              autoFocus
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && customInput.trim()) {
                  setModel(customInput.trim());
                  setCustomInput("");
                  setOpen(false);
                }
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
              placeholder="custom model…"
              style={{
                width: "100%",
                background: "var(--bg)",
                border: "1px solid var(--border-strong)",
                borderRadius: "4px",
                padding: "5px 8px",
                color: "var(--input-text)",
                fontSize: "11px",
                fontFamily: "'JetBrains Mono', monospace",
                outline: "none",
                boxSizing: "border-box",
              }}
              onFocus={(e) => (e.target.style.borderColor = t.accentSubtle)}
              onBlur={(e) => (e.target.style.borderColor = t.borderStrong)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
