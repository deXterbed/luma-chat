import { useState, useEffect } from "react";
import { Minus, Square, X, Maximize2 } from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import { useAppStore } from "../store/appStore";
import { getTheme } from "../theme";

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const theme = useAppStore((s) => s.theme);
  const t = getTheme(theme);

  useEffect(() => {
    if (!window.electron) return;
    window.electron.isMaximized().then(setIsMaximized);
    window.electron.onMaximized(setIsMaximized);
  }, []);

  const handleMinimize = () => window.electron?.minimize();
  const handleMaximize = () => window.electron?.maximize();
  const handleClose = () => window.electron?.close();

  return (
    <div
      className="titlebar"
      style={{
        WebkitAppRegion: "drag",
        height: "38px",
        background: "var(--titlebar-bg)",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingLeft: "16px",
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {/* App name */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <div
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: "linear-gradient(135deg, #a78bfa, #60a5fa)",
          }}
        />
        <span
          style={{
            fontFamily: "'Geist', sans-serif",
            fontSize: "12px",
            fontWeight: "600",
            color: "var(--text-muted)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Luma
        </span>
      </div>

      {/* Right side: theme toggle + window controls */}
      <div
        style={{
          WebkitAppRegion: "no-drag",
          display: "flex",
          alignItems: "center",
        }}
      >
        <ThemeToggle />

        <button
          onClick={handleMinimize}
          className="win-btn"
          style={{
            width: "46px",
            height: "38px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--win-btn-color)",
            transition: "background 0.15s, color 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--win-btn-hover)";
            e.currentTarget.style.color = "var(--win-btn-color-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--win-btn-color)";
          }}
        >
          <Minus size={12} />
        </button>
        <button
          onClick={handleMaximize}
          style={{
            width: "46px",
            height: "38px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--win-btn-color)",
            transition: "background 0.15s, color 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--win-btn-hover)";
            e.currentTarget.style.color = "var(--win-btn-color-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--win-btn-color)";
          }}
        >
          {isMaximized ? <Square size={11} /> : <Maximize2 size={11} />}
        </button>
        <button
          onClick={handleClose}
          style={{
            width: "46px",
            height: "38px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--win-btn-color)",
            transition: "background 0.15s, color 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--win-btn-close-hover)";
            e.currentTarget.style.color = "#fff";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--win-btn-color)";
          }}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
