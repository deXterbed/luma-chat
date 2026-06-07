import { useRef, useEffect, useState, useCallback } from "react";
import { Send, Square, Paperclip, X, ChevronDown } from "lucide-react";
import MessageBubble from "./MessageBubble";
import { streamChat, fileToBase64 } from "../lib/ollama";
import { TOOLS, executeTool } from "../lib/tools";
import {
  buildMainChatSystemPrompt,
  buildSideChatSystemPrompt,
} from "../lib/systemPrompt";
import { useChatSession } from "../hooks/useChatSession";
import { useAppStore } from "../store/appStore";
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

export default function ChatPane({
  store,
  contextStore,
  sideChatId,
  sessionId,
  placeholder = "Ask anything…",
  compact = false,
  label = "Chat",
}) {
  const {
    messages,
    model,
    isStreaming,
    error,
    setModel,
    addMessage,
    addStreamingMessage,
    updateStreamingMessage,
    addToolCall,
    completeToolCall,
    finalizeMessage,
    setError,
    clearError,
    setAbortController,
    stopStreaming,
    getApiMessages,
  } = store();

  const [input, setInput] = useState("");
  const [attachedImages, setAttachedImages] = useState([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [customModelInput, setCustomModelInput] = useState("");

  const { activeChatId, createSession, saveOnReply } = useChatSession({
    compact,
    sideChatId,
    sessionId,
    store,
  });

  const theme = useAppStore((s) => s.theme);
  const t = getTheme(theme);

  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const scrollContainerRef = useRef(null);
  // True when the user is "following" the latest content (i.e. near the
  // bottom). Flipped off as soon as they scroll up, and re-enabled for
  // every new response/turn via setAutoScroll(true).
  const autoScrollRef = useRef(true);

  useEffect(() => {
    // Only follow the bottom if the user is still following. If they've
    // scrolled up to read earlier content, don't yank them back down.
    if (autoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      // 50px threshold — close enough to the bottom counts as "following"
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      autoScrollRef.current = atBottom;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 160) + "px";
    }
  }, [input]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text && attachedImages.length === 0) return;
    if (isStreaming) return;

    clearError();

    const isFirstMessage = messages.length === 0;
    const images = attachedImages.map((img) => img.base64);
    addMessage("user", text, images);
    setInput("");
    setAttachedImages([]);
    // A new turn just started — resume following the latest content
    // for this response, regardless of where the user had scrolled.
    autoScrollRef.current = true;

    let currentSessionId = activeChatId;
    if (!compact && isFirstMessage)
      currentSessionId = createSession(text, model);

    const streamId = addStreamingMessage();
    // Tracks the most recent in-flight tool call id so onToolResult can
    // match its result back to the right call record.
    let currentCallId = null;
    const ctrl = new AbortController();
    setAbortController(ctrl);
    // Make sure we stick to the bottom for the new assistant response
    // even if the user had scrolled up between turns.
    autoScrollRef.current = true;

    try {
      const apiMessages = getApiMessages();
      let messagesForApi = apiMessages.filter(
        (m) => m.content !== "" || (m.images && m.images.length > 0),
      );

      // Pick the right system prompt for the chat type. Side chats
      // (compact mode) get a sub-investigation framing; main chats get
      // the general research-workbench framing. The functions inject
      // the current date and user's timezone at the top.
      const appSystemPrompt = compact
        ? buildSideChatSystemPrompt()
        : buildMainChatSystemPrompt();

      // Build the system messages in order: app-level first (persistent
      // behavior), then runtime context (main chat transcript for sides).
      const systemMessages = [{ role: "system", content: appSystemPrompt }];

      if (contextStore) {
        const ctxMessages = contextStore.getState().getApiMessages();
        if (ctxMessages.length > 0) {
          const transcript = ctxMessages
            .map(
              (m) =>
                `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`,
            )
            .join("\n\n");
          systemMessages.push({
            role: "system",
            content: `The following is the conversation from the main chat. Use it as context when answering the user's questions.\n\n${transcript}`,
          });
        }
      }

      messagesForApi = [...systemMessages, ...messagesForApi];

      await streamChat({
        model,
        messages: messagesForApi,
        tools: TOOLS,
        executeTool,
        onToken: (_, full) => updateStreamingMessage(streamId, full),
        onToolCall: (name, args) => {
          // Track the in-flight call id so onToolResult can match its
          // result back to the right call record.
          currentCallId = addToolCall(streamId, name, args);
        },
        onToolResult: (name, result) => {
          // Mark the in-flight call as done. We can't know the callId
          // from the API, so we close over the most recent one.
          if (currentCallId) {
            const isError =
              typeof result === "string" && result.startsWith("Error:");
            completeToolCall(streamId, currentCallId, {
              result: isError ? null : result,
              error: isError ? result : null,
            });
            currentCallId = null;
          }
        },
        onDone: (full) => {
          finalizeMessage(streamId, full);
          saveOnReply(streamId, full, model, currentSessionId);
        },
        signal: ctrl.signal,
      });
    } catch (err) {
      if (err.name === "AbortError") {
        finalizeMessage(
          streamId,
          store().messages.find((m) => m.id === streamId)?.content || "",
        );
      } else {
        finalizeMessage(streamId, "");
        setError(err.message);
      }
    }
  }, [input, attachedImages, isStreaming, model]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileAttach = async (e) => {
    const files = Array.from(e.target.files);
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    const converted = await Promise.all(
      imageFiles.map(async (f) => ({
        base64: await fileToBase64(f),
        name: f.name,
        preview: URL.createObjectURL(f),
      })),
    );
    setAttachedImages((prev) => [...prev, ...converted]);
    e.target.value = "";
  };

  const removeImage = (index) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePaste = useCallback(async (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (imageItems.length === 0) return;
    e.preventDefault();
    const converted = await Promise.all(
      imageItems.map(async (item) => {
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

  const canAttachImages = true;

  const px = compact ? "12px" : "20px";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg)",
        position: "relative",
      }}
    >
      {/* Pane header */}
      <div
        style={{
          padding: `10px ${px}`,
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
          background: "var(--bg-alt)",
        }}
      >
        <span
          style={{
            fontFamily: "'Geist', sans-serif",
            fontSize: compact ? "10px" : "11px",
            fontWeight: "600",
            color: "var(--text-faint)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          {label}
        </span>

        {/* Model selector */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setShowModelPicker(!showModelPicker)}
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
            onMouseEnter={(e) =>
              (e.currentTarget.style.borderColor = t.textSubtle)
            }
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

          {showModelPicker && (
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
                  onClick={() => {
                    setModel(m);
                    setShowModelPicker(false);
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
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
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
              ))}
              <div
                style={{
                  borderTop: "1px solid var(--border)",
                  padding: "6px 8px",
                }}
              >
                <input
                  autoFocus
                  value={customModelInput}
                  onChange={(e) => setCustomModelInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && customModelInput.trim()) {
                      setModel(customModelInput.trim());
                      setCustomModelInput("");
                      setShowModelPicker(false);
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
      </div>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onClick={() => setShowModelPicker(false)}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: compact ? "16px 14px" : "24px 20px",
          scrollbarWidth: "thin",
          scrollbarColor: "var(--scrollbar) transparent",
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              opacity: 0.25,
            }}
          >
            <div
              style={{
                width: compact ? "28px" : "36px",
                height: compact ? "28px" : "36px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, #a78bfa22, #60a5fa22)",
                border: "1px solid #a78bfa33",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: compact ? "8px" : "10px",
                  height: compact ? "8px" : "10px",
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #a78bfa, #60a5fa)",
                }}
              />
            </div>
            <span
              style={{
                fontFamily: "'Geist', sans-serif",
                fontSize: compact ? "11px" : "12px",
                color: t.accentDim,
              }}
            >
              {placeholder}
            </span>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {error && (
          <div
            style={{
              padding: "10px 14px",
              background: "var(--error-bg)",
              border: "1px solid var(--error-border)",
              borderRadius: "6px",
              color: "var(--status-err)",
              fontSize: "12px",
              fontFamily: "'JetBrains Mono', monospace",
              marginBottom: "12px",
            }}
          >
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Image previews */}
      {attachedImages.length > 0 && (
        <div
          style={{
            padding: "8px 14px 0",
            display: "flex",
            gap: "6px",
            flexWrap: "wrap",
            borderTop: "1px solid var(--border)",
          }}
        >
          {attachedImages.map((img, i) => (
            <div
              key={i}
              style={{ position: "relative", display: "inline-flex" }}
            >
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

      {/* Input area */}
      <div
        style={{
          padding: compact ? "10px 12px" : "14px 16px",
          borderTop: "1px solid var(--border)",
          background: "var(--bg-alt)",
          flexShrink: 0,
        }}
      >
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
          {/* File attach for vision models */}
          {canAttachImages && (
            <>
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
                onMouseLeave={(e) =>
                  (e.currentTarget.style.color = t.textFaint)
                }
                title="Attach image"
              >
                <Paperclip size={14} />
              </button>
            </>
          )}

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
              onClick={stopStreaming}
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
              onClick={handleSend}
              disabled={!input.trim() && attachedImages.length === 0}
              style={{
                background:
                  input.trim() || attachedImages.length > 0
                    ? "linear-gradient(135deg, #7c3aed, #3b82f6)"
                    : "var(--send-disabled)",
                border: "none",
                borderRadius: "5px",
                width: "28px",
                height: "28px",
                cursor:
                  input.trim() || attachedImages.length > 0
                    ? "pointer"
                    : "default",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color:
                  input.trim() || attachedImages.length > 0
                    ? "#fff"
                    : "var(--text-faint)",
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
    </div>
  );
}
