import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronDown, RefreshCw, X } from "lucide-react";
import { useUiStore } from "../store/uiStore";
import { listLocalModels } from "../lib/ollama";
import styles from "./ModelPicker.module.css";

export default function ModelPicker({ model, setModel, compact }) {
  const theme = useUiStore((s) => s.theme);
  const availableModels = useUiStore((s) => s.availableModels);
  const customModels = useUiStore((s) => s.customModels);
  const ollamaConnected = useUiStore((s) => s.ollamaConnected);
  const setAvailableModels = useUiStore((s) => s.setAvailableModels);
  const addCustomModel = useUiStore((s) => s.addCustomModel);
  const removeCustomModel = useUiStore((s) => s.removeCustomModel);
  const [open, setOpen] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  const mergedModels = useMemo(() => {
    const localSet = new Set(availableModels);
    const seen = new Set();
    const out = [];
    for (const m of availableModels) {
      if (seen.has(m)) continue;
      seen.add(m);
      out.push({ name: m, isCustom: false });
    }
    for (const m of customModels) {
      if (seen.has(m)) continue;
      seen.add(m);
      out.push({ name: m, isCustom: !localSet.has(m) });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [availableModels, customModels]);

  const handleToggle = async () => {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen) {
      setRefreshing(true);
      const models = await listLocalModels();
      setAvailableModels(models);
      setRefreshing(false);
    }
  };

  const handleCustomSubmit = () => {
    const name = customInput.trim();
    if (!name) return;
    addCustomModel(name);
    setModel(name);
    setCustomInput("");
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={styles.root}>
      <button onClick={handleToggle} className={styles.trigger}>
        <span className={`${styles.modelName} ${compact ? styles.modelNameCompact : ""}`}>
          {model}
        </span>
        <ChevronDown size={9} />
      </button>

      {open && (
        <div className={styles.dropdown}>
          <div className={styles.dropdownHeader}>
            <span>
              {ollamaConnected
                ? `${mergedModels.length} model${mergedModels.length === 1 ? "" : "s"}`
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
              className={styles.refreshBtn}
            >
              <RefreshCw
                size={10}
                style={{
                  animation: refreshing ? "spin 0.8s linear infinite" : "none",
                }}
              />
            </button>
          </div>
          <div className={styles.modelList}>
            {mergedModels.length === 0 ? (
              <div className={styles.emptyModels}>
                {ollamaConnected
                  ? "No models pulled. Run `ollama pull <model>` or add a custom one below."
                  : "Start Ollama to see local models."}
              </div>
            ) : (
              mergedModels.map(({ name: m, isCustom }) => (
                <div
                  key={m}
                  className={`${styles.modelRow} ${m === model ? styles.modelRowActive : ""}`}
                >
                  <button
                    onClick={() => {
                      setModel(m);
                      setOpen(false);
                    }}
                    className={`${styles.modelBtn} ${m === model ? styles.modelBtnActive : ""}`}
                  >
                    <span className={styles.modelBtnText}>
                      {m}
                    </span>
                    {isCustom && (
                      <span className={styles.customBadge}>custom</span>
                    )}
                  </button>
                  {isCustom && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeCustomModel(m);
                      }}
                      title="Remove from custom list"
                      className={styles.removeBtn}
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
          <div className={styles.customInputArea}>
            <input
              autoFocus
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleCustomSubmit();
                }
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
              placeholder="custom model…"
              className={styles.customInput}
            />
          </div>
        </div>
      )}
    </div>
  );
}
