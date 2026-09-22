import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// A stand-in for the real `streamChat` that never settles on its own. It
// records the options it was given so a test can hold a run open, replace the
// pane underneath it, and then do either of the two things the real stream can
// do on its way out: reject with the `Error("aborted")` that ollama.js throws
// when the signal fires, or finish normally via `onDone`.
const { streamChatMock, lastRun } = vi.hoisted(() => ({
  streamChatMock: vi.fn(),
  lastRun: { signal: null, onDone: null },
}));

vi.mock("../lib/ollama", async (importOriginal) => ({
  ...(await importOriginal()),
  streamChat: streamChatMock,
}));

import { useStreamingChat } from "./useStreamingChat";
import { useMainChat } from "../store/chatStore";
import { useSessionStore } from "../store/sessionStore";
import { db } from "../lib/db";

// Switching sessions (or starting a new chat) while a run is in flight used to
// leave the run alive with nothing on screen that it belonged to. Rust kept
// draining Ollama, and the run's save path read `store.getState().messages` at
// save time — the *new* session's messages — while writing them to the session
// id captured at send time. `sync_messages` upserts by id and deletes ids that
// are absent, so the switch replaced A's stored conversation with B's, or with
// nothing at all when the empty message list hit the delete branch.
describe("replacing the pane while a run is in flight", () => {
  const messageA = { id: "a1", role: "user", content: "A's earlier question" };
  const messageB = { id: "b1", role: "user", content: "B's own question" };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(db, "saveMessages").mockResolvedValue(undefined);
    vi.spyOn(db, "saveSession").mockResolvedValue(undefined);
    vi.spyOn(db, "updateSessionActivity").mockResolvedValue(undefined);
    streamChatMock.mockReset();
    lastRun.signal = null;
    lastRun.onDone = null;
    streamChatMock.mockImplementation(
      ({ signal, onDone }) =>
        new Promise((_resolve, reject) => {
          lastRun.signal = signal;
          lastRun.onDone = onDone;
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    // `useMainChat` is a module singleton — start each test from a known slate.
    // `loadMessages` also clears any controller a previous test left behind.
    useMainChat.getState().loadMessages([], "", []);
    useSessionStore.setState({
      activeChatId: "A",
      chatSessions: [
        {
          id: "A",
          title: "A",
          model: "test-model",
          messages: [messageA],
          sideChats: [],
          activeSideChatId: null,
          updated_at: 1,
        },
      ],
    });
    useMainChat.getState().loadMessages([messageA], "test-model", []);
  });

  const pane = () =>
    renderHook(() =>
      useStreamingChat({
        store: useMainChat,
        sessionId: "A",
        webSearchEnabled: false,
        thinkingEnabled: false,
      }),
    );

  const startRun = (result) =>
    act(async () => {
      result.current.handleSend("start a long answer");
    });

  const storedMessagesForA = () =>
    useSessionStore.getState().chatSessions.find((s) => s.id === "A").messages;

  it("stops the run and writes nothing into the session it was started for", async () => {
    const { result } = pane();
    await startRun(result);

    // The send-time save is legitimate: it persists the user's own message.
    expect(db.saveMessages).toHaveBeenCalledWith("A", expect.any(Array));
    expect(lastRun.signal.aborted).toBe(false);

    db.saveMessages.mockClear();
    await act(async () => {
      useSessionStore.getState().setActiveChatId("B");
      useMainChat.getState().loadMessages([messageB], "test-model", []);
    });

    // Nothing is left to write to, so the run is aborted rather than left
    // draining Ollama in the background.
    expect(lastRun.signal.aborted).toBe(true);

    // A completion that was already in flight when the user moved on must not
    // be able to write the new session's messages into A.
    await act(async () => {
      lastRun.onDone("an answer that started before the switch");
    });

    expect(db.saveMessages).not.toHaveBeenCalled();
    // A keeps its own conversation: its earlier question, plus the message the
    // user sent into it. B's question must never appear here.
    expect(storedMessagesForA().map((m) => m.content)).toEqual([
      "A's earlier question",
      "start a long answer",
    ]);
  });

  it("writes nothing when New Chat replaces the pane", async () => {
    const { result } = pane();
    await startRun(result);

    db.saveMessages.mockClear();
    await act(async () => {
      useSessionStore.getState().setActiveChatId(null);
      useMainChat.getState().clearMessages();
    });

    expect(lastRun.signal.aborted).toBe(true);
    await act(async () => {
      lastRun.onDone("an answer that started before the switch");
    });

    // The old message list is gone, so this is the branch that erased A's row
    // outright rather than overwriting it.
    expect(db.saveMessages).not.toHaveBeenCalled();
    expect(storedMessagesForA().map((m) => m.content)).toEqual([
      "A's earlier question",
      "start a long answer",
    ]);
    // The new chat's composer must not be stuck on the aborted run's flag:
    // that run now returns early, so nothing else will ever clear it.
    expect(useMainChat.getState().isStreaming).toBe(false);
  });
});
