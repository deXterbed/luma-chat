import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { Send, Square, Paperclip, X } from "lucide-react";
import { fileToBase64 } from "../lib/ollama";
import { matchCommands } from "../lib/commands";
import { activeMention, insertMention } from "../lib/fileMentions";
import {
  filterFiles,
  loadProjectFiles,
  projectFilesKey,
  NO_FILES,
} from "../lib/projectFiles";
import styles from "./InputArea.module.css";

// Files offered at once in the `@` popup.
const MAX_MENTION_MATCHES = 8;

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
  codebase = false,
  projectRoots = [],
}) {
  const [input, setInput] = useState("");
  const [attachedImages, setAttachedImages] = useState([]);
  const [cmdIndex, setCmdIndex] = useState(0);
  const [cmdDismissed, setCmdDismissed] = useState(false);
  // `@`-mention autocomplete: the token the caret sits inside (see
  // lib/fileMentions), and the index of files loaded for the attached roots.
  const [mention, setMention] = useState(null);
  const [files, setFiles] = useState(NO_FILES);
  const [activeIndex, setActiveIndex] = useState(0);
  // The `@` the user Escaped out of, so the popup stays closed while the caret
  // remains in that same token.
  const dismissedRef = useRef(null);

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

  // Slash-command palette. It opens while the input is a bare `/...` token
  // with no whitespace yet — type a space (to add args) and it steps out of
  // the way so Enter sends normally. `matchCommands` is the shared registry.
  const cmdPrefix = /^\/\S*$/.test(input) ? input : null;
  const cmdMatches =
    cmdPrefix && !cmdDismissed && !isStreaming ? matchCommands(cmdPrefix) : [];
  const paletteOpen = cmdMatches.length > 0;
  // Named distinctly from the `@` popup's `activeIndex` so the two pickers can
  // coexist in one component.
  const cmdActiveIndex = Math.min(cmdIndex, cmdMatches.length - 1);

  const doSend = useCallback(
    (overrideText) => {
      const text = (overrideText ?? input).trim();
      if (!text && attachedImages.length === 0) return;
      if (isStreaming) return;
      onSend(
        text,
        attachedImages.map((img) => img.base64),
      );
      setInput("");
      setAttachedImages([]);
      setCmdIndex(0);
      setCmdDismissed(false);
      setMention(null);
    },
    [input, attachedImages, isStreaming, onSend],
  );

  // ── @-mention autocomplete ──

  // Load the index for the attached roots. The dep is `projectFilesKey` (a
  // string) rather than the array, so a parent's fresh array identity doesn't
  // re-fire the walk on every render.
  const rootsKey = projectFilesKey(projectRoots);
  useEffect(() => {
    if (!codebase || !rootsKey) {
      setFiles(NO_FILES);
      return;
    }
    let alive = true;
    loadProjectFiles(projectRoots).then((list) => {
      if (alive) setFiles(list);
    });
    return () => {
      alive = false;
    };
    // `projectRoots` is read through `rootsKey` above, so it is intentionally
    // not a dependency — re-running on its array identity would defeat the key.
  }, [codebase, rootsKey]);

  const matches = useMemo(
    () =>
      mention ? filterFiles(files, mention.query, MAX_MENTION_MATCHES) : [],
    [mention, files],
  );

  // Recompute the active token from the textarea's own value and caret, so the
  // popup follows the cursor instead of only the last keystroke. Called on
  // change and on click; deliberately not on keyup, which would reset the
  // highlight on every arrow-key press.
  const syncMention = useCallback(
    (value, caret) => {
      if (!codebase) {
        setMention(null);
        return;
      }
      const found = activeMention(value, caret ?? value.length);
      if (!found) {
        dismissedRef.current = null;
        setMention(null);
        return;
      }
      if (dismissedRef.current === found.start) {
        setMention(null);
        return;
      }
      setMention(found);
      setActiveIndex(0);
    },
    [codebase],
  );

  const resync = useCallback(() => {
    const el = textareaRef.current;
    if (el) syncMention(el.value, el.selectionStart);
  }, [syncMention]);

  const pickMention = useCallback(
    (file) => {
      if (!file || !mention) return;
      const { text, caret } = insertMention(input, mention, file);
      setInput(text);
      dismissedRef.current = null;
      setMention(null);
      setActiveIndex(0);
      // Put the caret back after the inserted path, the same way the prefill
      // effect moves it.
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.selectionStart = caret;
        el.selectionEnd = caret;
      });
    },
    [input, mention],
  );

  const handleKeyDown = (e) => {
    // The `@` popup owns the arrow/Enter/Tab/Escape keys only while it has a
    // selection to act on (codex #12643: with no match, Enter still sends).
    if (mention && matches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(matches[activeIndex] || matches[0]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        dismissedRef.current = mention.start;
        setMention(null);
        return;
      }
    }
    if (paletteOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCmdIndex((i) => (i + 1) % cmdMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCmdIndex((i) => (i - 1 + cmdMatches.length) % cmdMatches.length);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setCmdDismissed(true);
        return;
      }
      if (e.key === "Tab") {
        // Complete in place (trailing space closes the palette) so the user
        // can append args, e.g. "/summarise keep it to 3 bullets".
        e.preventDefault();
        setInput(cmdMatches[cmdActiveIndex].name + " ");
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        doSend(cmdMatches[cmdActiveIndex].name);
        return;
      }
    }
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
      {/* @-mention autocomplete, above the input row */}
      {mention && matches.length > 0 && (
        <div
          className={`${styles.mentionList} ${compact ? styles.mentionListCompact : ""}`}
        >
          {matches.map((file, i) => (
            <button
              key={file}
              // Keep focus in the textarea — a focus shift on mousedown is what
              // makes a pick feel like it stole the caret.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickMention(file)}
              onMouseEnter={() => setActiveIndex(i)}
              className={`${styles.mentionItem} ${i === activeIndex ? styles.mentionItemActive : ""}`}
            >
              {file}
            </button>
          ))}
        </div>
      )}

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
        {paletteOpen && (
          <div className={styles.cmdPalette}>
            {cmdMatches.map((c, i) => (
              <button
                key={c.name}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => doSend(c.name)}
                onMouseEnter={() => setCmdIndex(i)}
                className={`${styles.cmdItem} ${i === cmdActiveIndex ? styles.cmdItemActive : ""}`}
              >
                <span className={styles.cmdName}>{c.name}</span>
                <span className={styles.cmdDesc}>{c.description}</span>
              </button>
            ))}
          </div>
        )}
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
          onChange={(e) => {
            setInput(e.target.value);
            setCmdIndex(0);
            setCmdDismissed(false);
            syncMention(e.target.value, e.target.selectionStart);
          }}
          onClick={resync}
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
            onClick={() => doSend()}
            disabled={!hasContent}
            className={`${styles.sendBtn} ${hasContent ? styles.sendBtnActive : styles.sendBtnDisabled}`}
            title="Send (Enter)"
          >
            <Send size={11} />
          </button>
        )}
      </div>

      <div className={styles.hint}>
        {codebase ? "@ to reference a file · " : ""}
        Enter to send · Shift+Enter for newline · / for commands
      </div>
    </div>
  );
}
