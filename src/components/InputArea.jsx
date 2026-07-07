import { useRef, useEffect, useState, useCallback } from "react";
import { Send, Square, Paperclip, X } from "lucide-react";
import { fileToBase64 } from "../lib/ollama";
import styles from "./InputArea.module.css";

export default function InputArea({
  onSend,
  isStreaming,
  onStop,
  compact,
  placeholder,
  prefill,
  onPrefillApplied,
  autoScrollEnabled,
  onToggleAutoScroll,
  focusNonce,
  autoFocus = false,
}) {
  const [input, setInput] = useState("");
  const [attachedImages, setAttachedImages] = useState([]);

  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 160) + "px";
    }
  }, [input]);

  useEffect(() => {
    if (!prefill) return;
    setInput(prefill);
    onPrefillApplied?.();
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.selectionStart = prefill.length;
        textareaRef.current.selectionEnd = prefill.length;
      }
    });
  }, [prefill]);

  // Focus the textarea when the parent bumps focusNonce (e.g. on a new
  // main chat). The main pane skips the initial mount so it doesn't steal
  // focus on app boot; side chats pass autoFocus so their input focuses on
  // mount (a side chat's InputArea only mounts when the tab is created —
  // exactly when focus is wanted — and bumpFocus runs in addSideChat
  // *before* mount, so the skip-initial guard would otherwise swallow it).
  const hasSeenFocusBump = useRef(false);
  useEffect(() => {
    if (!textareaRef.current) return;
    if (!autoFocus && !hasSeenFocusBump.current) {
      hasSeenFocusBump.current = true;
      return;
    }
    hasSeenFocusBump.current = true;
    textareaRef.current.focus();
  }, [focusNonce, autoFocus]);

  const doSend = useCallback(() => {
    const text = input.trim();
    if (!text && attachedImages.length === 0) return;
    if (isStreaming) return;
    onSend(
      text,
      attachedImages.map((img) => img.base64),
    );
    setInput("");
    setAttachedImages([]);
  }, [input, attachedImages, isStreaming, onSend]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  };

  const handleFileAttach = async (e) => {
    const files = Array.from(e.target.files).filter((f) =>
      f.type.startsWith("image/"),
    );
    const converted = await Promise.all(
      files.map(async (f) => ({
        base64: await fileToBase64(f),
        name: f.name,
        preview: URL.createObjectURL(f),
      })),
    );
    setAttachedImages((prev) => [...prev, ...converted]);
    e.target.value = "";
  };

  const handlePaste = useCallback(async (e) => {
    const items = Array.from(e.clipboardData?.items || []).filter((i) =>
      i.type.startsWith("image/"),
    );
    if (items.length === 0) return;
    e.preventDefault();
    const converted = await Promise.all(
      items.map(async (item) => {
        const file = item.getAsFile();
        return {
          base64: await fileToBase64(file),
          name: file.name || "pasted-image.png",
          preview: URL.createObjectURL(file),
        };
      }),
    );
    setAttachedImages((prev) => [...prev, ...converted]);
  }, []);

  const removeImage = (index) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const hasContent = input.trim() || attachedImages.length > 0;

  return (
    <div
      className={`${styles.wrapper} ${compact ? styles.wrapperCompact : ""}`}
    >
      {/* Image previews */}
      {attachedImages.length > 0 && (
        <div className={styles.imagePreviews}>
          {attachedImages.map((img, i) => (
            <div key={i} className={styles.imagePreviewItem}>
              <img
                src={img.preview}
                alt={img.name}
                className={styles.imagePreviewImg}
              />
              <button
                onClick={() => removeImage(i)}
                className={styles.imageRemoveBtn}
              >
                <X size={8} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={styles.inputRow}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={handleFileAttach}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className={styles.attachBtn}
          title="Attach image"
        >
          <Paperclip size={14} />
        </button>

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          rows={1}
          className={`${styles.textarea} ${compact ? styles.textareaCompact : ""}`}
        />

        {onToggleAutoScroll && (
          <button
            onClick={onToggleAutoScroll}
            className={`${styles.scrollBtn} ${autoScrollEnabled ? styles.scrollBtnActive : ""}`}
            title={
              autoScrollEnabled
                ? "Auto-scroll on — click to disable"
                : "Auto-scroll off — click to enable"
            }
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <polyline points="19 12 12 19 5 12" />
            </svg>
          </button>
        )}
        {isStreaming ? (
          <button onClick={onStop} className={styles.actionBtn} title="Stop">
            <Square size={11} fill="var(--send-icon)" />
          </button>
        ) : (
          <button
            onClick={doSend}
            disabled={!hasContent}
            className={`${styles.sendBtn} ${hasContent ? styles.sendBtnActive : styles.sendBtnDisabled}`}
            title="Send (Enter)"
          >
            <Send size={11} />
          </button>
        )}
      </div>

      <div className={styles.hint}>Enter to send · Shift+Enter for newline</div>
    </div>
  );
}
