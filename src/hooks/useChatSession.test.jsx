import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChatSession } from "./useChatSession";
import { createChatStore, getRememberedWebSearch } from "../store/chatStore";
import { useSessionStore } from "../store/sessionStore";
import { db } from "../lib/db";

vi.mock("../lib/db", () => ({
  db: {
    saveSession: vi.fn().mockResolvedValue(undefined),
    setProjectRoots: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("useChatSession", () => {
  beforeEach(() => {
    useSessionStore.setState({ chatSessions: [], activeChatId: null });
  });

  // The toggle is per chat, but the pane had no session id yet when the user
  // flipped it. Creating the row is the moment it needs an owner (see
  // `rememberWebSearch` / ChatPane).
  it("remembers the web search toggle for the session it creates", () => {
    const store = createChatStore(`session-remember-${Math.random()}`);
    store.getState().setWebSearchEnabled(true);
    const { result } = renderHook(() => useChatSession({ store }));

    act(() => {
      result.current.createSession("hello", "model");
    });

    const id = useSessionStore.getState().activeChatId;
    expect(id).toBeTruthy();
    expect(getRememberedWebSearch(id)).toBe(true);
    // Written in the INSERT too, so a separate update can't race the row.
    expect(db.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({ id, webSearch: true }),
    );
  });
});
