import { useCallback, useRef } from "react";
import { streamChat } from "../lib/ollama";
import { TOOLS, FILE_TOOL_NAMES, WEB_TOOL_NAMES, executeTool } from "../lib/tools";
import {
  buildMainChatSystemPrompt,
  buildSideChatSystemPrompt,
} from "../lib/systemPrompt";
import { buildFollowUpMessages, parseSubtopics } from "../lib/followups";
import { useChatSession } from "./useChatSession";
import { useSettingsStore } from "../store/settingsStore";
import { useSessionStore } from "../store/sessionStore";
import { createAgentLogger } from "../lib/agentLog";
import {
  cachedModelWindow,
  loadModelWindow,
  resolveNumCtx,
} from "../lib/modelContext";

// Stable identity for "no roots" — a fresh [] on every render would defeat the
// store subscription (which compares by reference).
const NO_ROOTS = [];

// Codebase-mode loop policy (see plan.md). Chat mode keeps its existing numbers:
// the wrap-up nudge at 10 rounds, no file budgets, the DuckDuckGo nudge live.
const CODEBASE_MAX_TOOL_ROUNDS = 20;
// Call count is the *second* line of defence, not the first: the listings now
// report file sizes, so the model pages a large file instead of reading it
// whole, which trades byte pressure for call pressure. Raised from 40 to keep
// that trade from just moving the cut-off point (a full 150k-byte sweep in
// ~200-line pages is ~19 reads, and searches share this budget). The byte
// budget is what actually bounds read spend; a log that now trips on calls
// rather than bytes means this number is still too low.
const CODEBASE_MAX_FILE_CALLS = 60;
// Roughly one full context's worth of source. Per-call caps bound a single read;
// nothing bounds thirty of them, and each round re-sends the whole transcript.
const CODEBASE_MAX_FILE_BYTES = 150_000;

// Project folders are logged by basename, never by absolute path: the log is a
// file the user might share when reporting a problem, and a path carries their
// username. The sessions table already holds the real paths.
const folderLabel = (path) =>
  (path || "").split(/[\\/]/).filter(Boolean).pop() || path;

export function useStreamingChat({
  store,
  contextStore,
  compact,
  sideChatId,
  sessionId,
  webSearchEnabled,
  thinkingEnabled,
}) {
  // Subscribe only to values that drive re-renders or guard logic
  const model = store((s) => s.model);
  const isStreaming = store((s) => s.isStreaming);
  const error = store((s) => s.error);
  const paneRoots = store((s) => s.projectRoots);

  // Codebase mode is derived: an attached project folder *is* the mode. The
  // pane's own roots are the live value (a folder can be attached before the
  // session row exists); a side chat never sets them, so it reads its parent
  // session's — which is also how it inherits the mode without its own toggle.
  const session = useSessionStore(
    (s) => s.chatSessions.find((c) => c.id === sessionId) || null,
  );
  const roots =
    paneRoots.length > 0 ? paneRoots : (session?.projectRoots ?? NO_ROOTS);
  const codebase = roots.length > 0;

  const { activeChatId, createSession, saveNow, saveOnReply } = useChatSession({
    sideChatId,
    sessionId,
    store,
  });

  // Shared streaming pipeline. `afterMessageId` is set when re-sending after
  // an inline edit (so the new assistant turn won't re-create the session or
  // re-add a user message). For normal sends it's undefined.
  const runStream = useCallback(
    async ({ text, images = [], afterMessageId }) => {
      // Use store.getState() for all imperative calls inside the callback so
      // async callbacks (onToken, onDone, etc.) always read fresh state rather
      // than stale closures captured at render time.
      store.getState().clearError();

      const isFirstMessage = store.getState().messages.length === 0;
      if (!afterMessageId) {
        store.getState().addMessage("user", text, images);
      }

      let currentSessionId = activeChatId;
      if (!sideChatId && isFirstMessage && !afterMessageId) {
        currentSessionId = createSession(text, model);
      }

      // Persist the user message before streaming starts so it survives a
      // crash, close, or error mid-generation.
      saveNow(currentSessionId, model);

      const streamId = store.getState().addStreamingMessage();
      // Parallel tool execution means multiple calls can be in flight at once,
      // so track each call's id by its index in the round's tool_calls batch
      // (the index onToolCall/onToolResult now carry) instead of a single id.
      const pendingCallIds = new Map();
      const ctrl = new AbortController();
      store.getState().setAbortController(ctrl);

      // Throttle token updates to rAF cadence (~60fps). Without this, fast
      // models trigger Zustand set() hundreds of times per second, causing
      // every MessageBubble to re-render on every token.
      const pendingContent = { current: null, rafId: null };
      const flushToken = () => {
        pendingContent.rafId = null;
        if (ctrl.signal.aborted) return;
        if (pendingContent.current !== null) {
          store.getState().updateStreamingMessage(streamId, pendingContent.current);
          pendingContent.current = null;
        }
      };

      const pendingThinking = { current: null, rafId: null };
      const flushThinking = () => {
        pendingThinking.rafId = null;
        if (ctrl.signal.aborted) return;
        if (pendingThinking.current !== null) {
          store.getState().updateThinking(streamId, pendingThinking.current);
          pendingThinking.current = null;
        }
      };

      // Apply whatever the rAF throttle is still holding, then cancel the frame.
      // `content` survives without this — the final callback carries it in full —
      // but reasoning has no such backstop, and cancelling the pending frame
      // would drop its last chunk. That used to be a display blip; now that
      // thinking is persisted, it would be a permanent hole in the record.
      // Called on every way the stream can end, including abort, where the
      // partial reasoning is part of what `saveNow` writes.
      const flushPending = () => {
        if (pendingContent.rafId !== null) {
          cancelAnimationFrame(pendingContent.rafId);
          pendingContent.rafId = null;
        }
        if (pendingThinking.rafId !== null) {
          cancelAnimationFrame(pendingThinking.rafId);
          pendingThinking.rafId = null;
        }
        if (pendingThinking.current !== null) {
          store.getState().updateThinking(streamId, pendingThinking.current);
          pendingThinking.current = null;
        }
        if (pendingContent.current !== null) {
          store.getState().updateStreamingMessage(streamId, pendingContent.current);
          pendingContent.current = null;
        }
      };

      try {
        const apiMessages = store
          .getState()
          .getApiMessages()
          .filter((m) => m.content !== "" || (m.images && m.images.length > 0));

        const appSystemPrompt = compact
          ? buildSideChatSystemPrompt({ webSearchEnabled, codebase, roots })
          : buildMainChatSystemPrompt({ webSearchEnabled, codebase, roots });

        const systemMessages = [{ role: "system", content: appSystemPrompt }];

        if (contextStore) {
          const ctxMessages = contextStore.getState().getApiMessages();
          if (ctxMessages.length > 0) {
            // Limit to the most recent 10 messages to avoid overflowing small
            // local model context windows on long sessions.
            const recent = ctxMessages.slice(-10);
            let transcript = recent
              .map(
                (m) =>
                  `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`,
              )
              .join("\n\n");
            if (transcript.length > 4000) {
              transcript = "…" + transcript.slice(-4000);
            }
            const ctxSystem = {
              role: "system",
              content: `The following is the recent conversation from the main chat. Use it as context when answering the user's questions.\n\n${transcript}`,
            };
            systemMessages.push(ctxSystem);
          }
        }

        // Withhold tools the mode can't use: web tools unless the user turned
        // them on, file tools unless a project folder is attached.
        const activeTools = TOOLS.filter((t) => {
          const name = t.function.name;
          if (WEB_TOOL_NAMES.includes(name)) return webSearchEnabled;
          if (FILE_TOOL_NAMES.includes(name)) return codebase;
          return true;
        });

        // The file tools need the roots the model can never supply itself.
        const runTool = (name, args) => executeTool(name, args, { roots });

        const loopPolicy = codebase
          ? {
              maxToolRounds: CODEBASE_MAX_TOOL_ROUNDS,
              // `null` disables the DuckDuckGo nudge: it fires on the round
              // number alone, so round 15 would otherwise tell the model to
              // stop mid-exploration of a repo it may not have searched at all.
              webSearchNudgeAt: null,
              maxFileCalls: CODEBASE_MAX_FILE_CALLS,
              maxFileBytes: CODEBASE_MAX_FILE_BYTES,
            }
          : {};

        // Best-effort follow-up subtopic generation, fired from onDone after
        // the answer finalizes. Reads the recent conversation from the store,
        // runs a focused one-shot call (no tools), parses the JSON, and attaches
        // the chips to the finished message. Swallows all errors — chips are a
        // progressive enhancement, never a hard failure.
        const generateSubtopics = async (messageId) => {
          const began = Date.now();
          try {
            const recent = store.getState().getApiMessages().slice(-4);
            if (recent.length === 0) return;
            let raw = "";
            await streamChat({
              model,
              messages: buildFollowUpMessages(recent),
              tools: [],
              think: false,
              // Reuse the pane's abort signal so Stop / sending a new message
              // cancels this follow-up call too — otherwise it keeps running
              // (consuming quota/network) after the user has moved on.
              signal: ctrl.signal,
              onDone: (full) => {
                raw = full;
              },
            });
            const subs = parseSubtopics(raw);
            if (subs.length > 0) store.getState().setSubtopics(messageId, subs);
            // A second inference the user is paying for and waiting on — track
            // it separately from the answer's own rounds.
            log.event("subtopics", { ok: true, count: subs.length, ms: Date.now() - began });
          } catch (err) {
            // follow-up generation is best-effort; never surface an error
            log.event("subtopics", {
              ok: false,
              ms: Date.now() - began,
              message: err?.message || String(err),
            });
          }
        };

        // How much context this run gets. Codebase mode raises it for a cloud
        // model, capped by the model's real window — read once per model and
        // cached, but if it hasn't landed yet this message goes out on the
        // setting and the lookup is kicked off for the next one.
        const settings = useSettingsStore.getState();
        const modelWindow = cachedModelWindow(model);
        if (codebase && modelWindow === undefined) loadModelWindow(model);
        const numCtx = resolveNumCtx({
          codebase,
          model,
          setting: settings.numCtx,
          modelWindow,
        });

        // The log records what the harness *chose* for this run as much as what
        // the model did: the prompt text, which tools were offered, and which
        // mode the loop was in. Without the inputs, a log of failures can't
        // tell you whether the harness or the model was at fault.
        const log = createAgentLogger({
          enabled: settings.agentLogEnabled,
        });
        log.event("stream.start", {
          sessionId,
          sideChatId: sideChatId ?? null,
          compact,
          model,
          codebase,
          roots: roots.map(folderLabel),
          tools: activeTools.map((t) => t.function.name),
          webSearchEnabled,
          thinking: thinkingEnabled,
          // Why `numCtx` resolved the way it did: the model's own window, and
          // the setting it was raised from (`null` setting value = defaults).
          numCtx,
          modelWindow: modelWindow ?? null,
          numCtxSetting: settings.numCtx,
          systemPrompt: appSystemPrompt,
          // The injected parent-chat transcript is summarised rather than
          // copied: it's derived from the main chat, which is recoverable.
          contextBlocks: systemMessages.slice(1).map((m) => ({
            chars: m.content.length,
            head: m.content.slice(0, 200),
          })),
          userText: (text || "").slice(0, 300),
        });

        await streamChat({
          model,
          messages: [...systemMessages, ...apiMessages],
          tools: activeTools,
          executeTool: runTool,
          log,
          think: thinkingEnabled,
          toolCallLimit: settings.toolCallLimit,
          numCtx,
          temperature: settings.temperature,
          ...loopPolicy,
          onToken: (_, full) => {
            pendingContent.current = full;
            if (pendingContent.rafId === null) {
              pendingContent.rafId = requestAnimationFrame(flushToken);
            }
          },
          onThinking: (_, full) => {
            pendingThinking.current = full;
            if (pendingThinking.rafId === null) {
              pendingThinking.rafId = requestAnimationFrame(flushThinking);
            }
          },
          onToolCall: (name, args, index) => {
            pendingCallIds.set(
              index,
              store.getState().addToolCall(streamId, name, args),
            );
          },
          onToolResult: (_, result, index) => {
            const callId = pendingCallIds.get(index);
            if (callId) {
              const isError =
                typeof result === "string" && result.startsWith("Error:");
              store.getState().completeToolCall(streamId, callId, {
                result: isError ? null : result,
                error: isError ? result : null,
              });
              pendingCallIds.delete(index);
            }
          },
          onDone: (full) => {
            flushPending();
            store.getState().finalizeMessage(streamId, full);
            saveOnReply(streamId, full, model, currentSessionId);
            // Fire-and-forget: generate clickable follow-up chips via a
            // dedicated one-shot call after the answer finalizes. The model
            // won't reliably call a side-effect "suggest" tool on follow-up
            // turns, so we decouple it into its own focused inference. Best
            // effort — never surfaces an error or blocks the UI. Subtopics are
            // transient (not persisted on purpose, unlike thinking — the chips
            // are cheap to regenerate and go stale immediately).
            generateSubtopics(streamId);
          },
          signal: ctrl.signal,
        });
      } catch (err) {
        flushPending();
        if (err.name === "AbortError" || err.message === "aborted") {
          const partial =
            store.getState().messages.find((m) => m.id === streamId)
              ?.content || "";
          store.getState().finalizeMessage(streamId, partial);
          saveNow(currentSessionId, model);
        } else {
          store.getState().finalizeMessage(streamId, "");
          store.getState().setError(err.message);
          saveNow(currentSessionId, model);
        }
      }
    },
    [
      activeChatId,
      codebase,
      compact,
      contextStore,
      createSession,
      model,
      roots,
      saveNow,
      saveOnReply,
      store,
      thinkingEnabled,
      webSearchEnabled,
    ],
  );

  const handleSend = useCallback(
    async (text, images = []) => {
      if (!text && images.length === 0) return;
      if (isStreaming) return;
      await runStream({ text, images });
    },
    [isStreaming, runStream],
  );

  // Re-send after inline-editing a user message. `afterMessageId` is the
  // edited user message — we truncate everything after it and stream a new
  // assistant reply. Same logic as a fresh send, but the edited message is
  // already in the store (no new addMessage).
  const resend = useCallback(
    async (afterMessageId, text) => {
      if (isStreaming) return;
      store.getState().truncateAfter(afterMessageId);
      store.getState().editMessage(afterMessageId, text);
      store.getState().clearError();
      await runStream({ text, images: [], afterMessageId });
    },
    [isStreaming, runStream, store],
  );

  return {
    handleSend,
    resend,
    isStreaming,
    error,
    stopStreaming: store.getState().stopStreaming,
    clearError: store.getState().clearError,
  };
}
