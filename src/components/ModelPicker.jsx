import { useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { useUiStore } from "../store/uiStore";
import { getTheme } from "../theme";
import { listLocalModels } from "../lib/ollama";

export default function ModelPicker({ model, setModel, compact }) {
  const theme = useUiStore((s) => s.theme);
  const availableModels = useUiStore((s) => s.availableModels);
  const ollamaConnected = useUiStore((s) => s.ollamaConnected);
  const setAvailableModels = useUiStore((s) => s.setAvailableModels);
  const t = getTheme(theme);
  const [open, setOpen] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const handleToggle = async () => {
    const willOpen = !open;
    setOpen(willOpen);
    // Refresh on open so newly-pulled models show up without a relaunch
    if (willOpen) {
      setRefreshing(true);
      const models = await listLocalModels();
      setAvailableModels(models);
      setRefreshing(false);
    }
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={handleToggle}
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
        onMouseLeave={(e) =>
          (e.currentTarget.style.borderColor = t.borderStrong)
        }
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 10px",
              borderBottom: "1px solid var(--border)",
              fontSize: "9px",
              fontFamily: "'JetBrains Mono', monospace",
              color: t.textSubtle,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            <span>
              {ollamaConnected
                ? `${availableModels.length} local model${availableModels.length === 1 ? "" : "s"}`
                : "Ollama offline"}
            </span>
            <button
              onClick={async (e) => {
                e.stopPropagation();
                setRefreshing(true);
                const models = await listLocalModels();
                setAvailableModels(models);
                setRefreshing(false);
              }}
              title="Refresh model list"
              style={{
                background: "transparent",
                border: "none",
                color: t.textSubtle,
                cursor: "pointer",
                padding: 0,
                display: "flex",
                alignItems: "center",
              }}
            >
              <RefreshCw
                size={10}
                style={{
                  animation: refreshing ? "spin 0.8s linear infinite" : "none",
                }}
              />
            </button>
          </div>
          <div style={{ maxHeight: "240px", overflowY: "auto" }}>
            {availableModels.length === 0 ? (
              <div
                style={{
                  padding: "10px 12px",
                  fontSize: "10px",
                  fontFamily: "'JetBrains Mono', monospace",
                  color: t.textSubtle,
                }}
              >
                {ollamaConnected
                  ? "No models pulled. Run `ollama pull <model>` to add one."
                  : "Start Ollama to see local models."}
              </div>
            ) : (
              availableModels.map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setModel(m);
                    setOpen(false);
                  }}
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
                  onMouseEnter={(e) => {
                    if (m !== model)
                      e.currentTarget.style.background = t.surface;
                  }}
                  onMouseLeave={(e) => {
                    if (m !== model)
                      e.currentTarget.style.background = "transparent";
                  }}
                >
                  {m}
                </button>
              ))
            )}
          </div>
          <div
            style={{ borderTop: "1px solid var(--border)", padding: "6px 8px" }}
          >
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
