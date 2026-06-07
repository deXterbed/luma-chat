import { useRef, useEffect, useState, useCallback } from "react";
import { Send, Square, Paperclip, X } from "lucide-react";
import { fileToBase64 } from "../lib/ollama";
import { useUiStore } from "../store/uiStore";
import { getTheme } from "../theme";

export default function InputArea({ onSend, isStreaming, onStop, compact, placeholder, prefill, onPrefillApplied }) {
  const theme = useUiStore((s) => s.theme);
  const t = getTheme(theme);

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

  const doSend = useCallback(() => {
    const text = input.trim();
    if (!text && attachedImages.length === 0) return;
    if (isStreaming) return;
    onSend(text, attachedImages.map((img) => img.base64));
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
    const files = Array.from(e.target.files).filter((f) => f.type.startsWith("image/"));
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
      style={{
        padding: compact ? "10px 12px" : "14px 16px",
        borderTop: "1px solid var(--border)",
        background: "var(--bg-alt)",
        flexShrink: 0,
      }}
    >
      {/* Image previews */}
      {attachedImages.length > 0 && (
        <div
          style={{
            marginBottom: "8px",
            display: "flex",
            gap: "6px",
            flexWrap: "wrap",
          }}
        >
          {attachedImages.map((img, i) => (
            <div key={i} style={{ position: "relative", display: "inline-flex" }}>
              <img
                src={img.preview}
                alt={img.name}
                style={{
                  width: "52px",
                  height: "52px",
                  objectFit: "cover",
                  borderRadius: "5px",
                  border: "1px solid var(--border-strong)",
                }}
              />
              <button
                onClick={() => removeImage(i)}
                style={{
                  position: "absolute",
                  top: "-4px",
                  right: "-4px",
                  width: "16px",
                  height: "16px",
                  borderRadius: "50%",
                  background: t.surface,
                  border: "1px solid var(--border-strong)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-subtle)",
                }}
              >
                <X size={8} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          background: "var(--surface)",
          border: "1px solid var(--border-strong)",
          borderRadius: "8px",
          padding: "8px 10px",
          transition: "border-color 0.15s",
        }}
      >
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
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--text-faint)",
            padding: "2px",
            flexShrink: 0,
            transition: "color 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = t.accent)}
          onMouseLeave={(e) => (e.currentTarget.style.color = t.textFaint)}
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
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--text)",
            fontSize: compact ? "13px" : "14px",
            fontFamily: "system-ui, sans-serif",
            lineHeight: 1.5,
            resize: "none",
            overflowY: "hidden",
            caretColor: "var(--caret)",
          }}
        />

        {isStreaming ? (
          <button
            onClick={onStop}
            style={{
              background: "var(--user-bubble)",
              border: "1px solid var(--border-strong)",
              borderRadius: "5px",
              width: "28px",
              height: "28px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--send-icon)",
              flexShrink: 0,
              transition: "all 0.15s",
            }}
            title="Stop"
          >
            <Square size={11} fill="var(--send-icon)" />
          </button>
        ) : (
          <button
            onClick={doSend}
            disabled={!hasContent}
            style={{
              background: hasContent
                ? "linear-gradient(135deg, #7c3aed, #3b82f6)"
                : "var(--send-disabled)",
              border: "none",
              borderRadius: "5px",
              width: "28px",
              height: "28px",
              cursor: hasContent ? "pointer" : "default",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: hasContent ? "#fff" : "var(--text-faint)",
              flexShrink: 0,
              transition: "all 0.15s",
            }}
            title="Send (Enter)"
          >
            <Send size={11} />
          </button>
        )}
      </div>

      <div
        style={{
          marginTop: "5px",
          fontSize: "9px",
          color: "var(--text-faint)",
          opacity: 0.6,
          fontFamily: "'JetBrains Mono', monospace",
          textAlign: "right",
        }}
      >
        Enter to send · Shift+Enter for newline
      </div>
    </div>
  );
}
