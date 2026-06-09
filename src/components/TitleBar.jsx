import { useState, useEffect } from "react";
import { Minus, Square, X, Maximize2 } from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import { useUiStore } from "../store/uiStore";
import styles from "./TitleBar.module.css";

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const theme = useUiStore((s) => s.theme);

  useEffect(() => {
    let unlisten = null;

    async function setup() {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();

        setIsMaximized(await win.isMaximized());

        unlisten = await win.onResized(async () => {
          setIsMaximized(await win.isMaximized());
        });
      } catch {
        // Running in browser — no Tauri window API
      }
    }

    setup();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleMinimize = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch {}
  };

  const handleMaximize = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().toggleMaximize();
    } catch {}
  };

  const handleClose = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch {}
  };

  return (
    <div className={styles.titlebar}>
      {/* App name */}
      <div className={styles.brand}>
        <div className={styles.brandDot} />
        <span className={styles.brandText}>Luma</span>
      </div>

      {/* Right side: theme toggle + window controls */}
      <div className={styles.controls}>
        <ThemeToggle />

        <button onClick={handleMinimize} className={styles.winBtn}>
          <Minus size={12} />
        </button>
        <button onClick={handleMaximize} className={styles.winBtn}>
          {isMaximized ? <Square size={11} /> : <Maximize2 size={11} />}
        </button>
        <button
          onClick={handleClose}
          className={`${styles.winBtn} ${styles.winBtnClose}`}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
