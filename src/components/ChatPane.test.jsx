import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import ChatPane from "./ChatPane";
import { createChatStore } from "../store/chatStore";
import { useSessionStore } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";
import { db } from "../lib/db";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

// File reads and web access in one context is Luma's egress pair: a fetched page
// can order a file read, and a file's contents can leave inside a URL. So the
// pane whose project folder is attached must start with web search *off*, even
// when the user's global default is on.
describe("ChatPane web search in Codebase mode", () => {
  beforeEach(() => {
    useSettingsStore.setState({ hydrated: true, webSearchDefault: true });
    useSessionStore.setState({ chatSessions: [] });
    vi.clearAllMocks();
    vi.spyOn(db, "setSessionWebSearch").mockResolvedValue(undefined);
    vi.spyOn(db, "setSideChatWebSearch").mockResolvedValue(undefined);
  });

  it("seeds on from the default with no project attached", () => {
    const store = createChatStore("websearch-chat");
    render(<ChatPane store={store} sessionId="s1" />);
    expect(screen.getByTitle("Web search on")).toBeInTheDocument();
  });

  it("switches off when a folder is attached, and off for a side chat that inherits one", () => {
    const store = createChatStore("websearch-codebase");
    const { unmount } = render(<ChatPane store={store} sessionId="s1" />);
    expect(screen.getByTitle("Web search on")).toBeInTheDocument();

    act(() => store.getState().setProjectRoots(["/tmp/some-project"]));
    expect(screen.getByTitle("Web search off")).toBeInTheDocument();
    // Attaching is a real off, not just a live override: the persisted value
    // has to match, or a restart while attached would turn search back on.
    expect(db.setSessionWebSearch).toHaveBeenCalledWith("s1", false);
    unmount();

    // A side chat has no roots of its own and reads its session's, so the same
    // default has to hold there too.
    useSessionStore.setState({
      chatSessions: [{ id: "s2", projectRoots: ["/tmp/some-project"] }],
    });
    const sideStore = createChatStore("websearch-side");
    render(<ChatPane store={sideStore} sessionId="s2" sideChatId="sc1" isSideChat />);
    expect(screen.getByTitle("Web search off")).toBeInTheDocument();
  });

  // A side chat's toggle follows the pane it was opened from, not the global
  // setting — the parent's choice of whether to reach the web is the relevant
  // default for a question asked of it. `contextStore` is that parent (the main
  // chat here; a branched side chat passes its parent side chat).
  it("inherits the parent pane's value, not the global default", () => {
    // Parent off, global on (beforeEach) → the side chat must follow the parent.
    const parentStore = createChatStore("inherit-parent-off");
    const childStore = createChatStore("inherit-child-off");
    render(
      <ChatPane
        store={childStore}
        contextStore={parentStore}
        sessionId="s3"
        sideChatId="sc2"
        isSideChat
      />,
    );
    expect(screen.getByTitle("Web search off")).toBeInTheDocument();
  });

  it("inherits the parent's on, even when the global default is off", () => {
    useSettingsStore.setState({ webSearchDefault: false });
    const parentStore = createChatStore("inherit-parent-on");
    parentStore.getState().setWebSearchEnabled(true);
    const childStore = createChatStore("inherit-child-on");
    render(
      <ChatPane
        store={childStore}
        contextStore={parentStore}
        sessionId="s4"
        sideChatId="sc3"
        isSideChat
      />,
    );
    expect(screen.getByTitle("Web search on")).toBeInTheDocument();
  });

  // Each chat owns its toggle: switching away and back restores what that chat
  // had, while a chat that never had a value starts from the default.
  it("remembers each chat's own toggle", () => {
    useSettingsStore.setState({ webSearchDefault: false });
    const store = createChatStore("websearch-per-chat");
    const { rerender } = render(<ChatPane store={store} sessionId="chat-a" />);
    expect(screen.getByTitle("Web search off")).toBeInTheDocument();

    act(() => fireEvent.click(screen.getByTitle("Web search off")));
    expect(screen.getByTitle("Web search on")).toBeInTheDocument();
    expect(db.setSessionWebSearch).toHaveBeenCalledWith("chat-a", true);

    act(() => {
      rerender(<ChatPane store={store} sessionId="chat-b" />);
    });
    expect(screen.getByTitle("Web search off")).toBeInTheDocument();

    act(() => {
      rerender(<ChatPane store={store} sessionId="chat-a" />);
    });
    expect(screen.getByTitle("Web search on")).toBeInTheDocument();
  });

  // The first message is what turns an unsaved chat into a session row; the
  // toggle picked before sending belongs to that row (see `useChatSession`'s
  // test — this pins the pane half: an id with a remembered value wins).
  it("restores a chat's remembered value after an unsaved chat", () => {
    useSettingsStore.setState({ webSearchDefault: false });
    const store = createChatStore("websearch-unsaved");
    const { rerender } = render(<ChatPane store={store} sessionId="remembered-chat" />);

    act(() => fireEvent.click(screen.getByTitle("Web search off")));
    expect(screen.getByTitle("Web search on")).toBeInTheDocument();

    act(() => rerender(<ChatPane store={store} sessionId={null} />));
    expect(screen.getByTitle("Web search off")).toBeInTheDocument();

    act(() => rerender(<ChatPane store={store} sessionId="remembered-chat" />));
    expect(screen.getByTitle("Web search on")).toBeInTheDocument();
  });

  it("persists a side chat's toggle to its own row", () => {
    useSettingsStore.setState({ webSearchDefault: false });
    const parentStore = createChatStore("persist-parent");
    const store = createChatStore("persist-side");
    render(
      <ChatPane
        store={store}
        contextStore={parentStore}
        sessionId="persist-session"
        sideChatId="persist-sc"
        isSideChat
      />,
    );

    act(() => fireEvent.click(screen.getByTitle("Web search off")));

    expect(db.setSideChatWebSearch).toHaveBeenCalledWith("persist-sc", true);
    expect(db.setSessionWebSearch).not.toHaveBeenCalled();
  });

  it("re-seeds from the default on New Chat", () => {
    useSettingsStore.setState({ webSearchDefault: false });
    const store = createChatStore("websearch-new-chat");
    const { rerender } = render(<ChatPane store={store} sessionId="new-chat-session" />);

    act(() => fireEvent.click(screen.getByTitle("Web search off")));
    expect(screen.getByTitle("Web search on")).toBeInTheDocument();

    act(() => {
      store.getState().clearMessages();
      rerender(<ChatPane store={store} sessionId={null} />);
    });
    expect(screen.getByTitle("Web search off")).toBeInTheDocument();
  });
});

// Attaching is additive: several folders can be attached, each stays
// individually removable, and one refused pick must not discard the others.
describe("ChatPane attaching project folders", () => {
  beforeEach(() => {
    useSettingsStore.setState({ hydrated: true, projectRemoteNoticeAck: true });
    useSessionStore.setState({ chatSessions: [] });
    vi.restoreAllMocks();
    // Rust owns validation; outside it the command is a no-op, so the tests
    // stand in for it and return the path unchanged.
    vi.spyOn(db, "validateProjectRoot").mockImplementation(async (path) => path);
    vi.spyOn(db, "setProjectRoots").mockResolvedValue(undefined);
  });

  const attach = async (title) => {
    await act(async () => {
      fireEvent.click(screen.getByTitle(title));
    });
  };

  it("attaches every folder a multi-select returns", async () => {
    openDialog.mockResolvedValue(["/picked/api", "/picked/web"]);
    const store = createChatStore("attach-multi");
    render(<ChatPane store={store} />);

    await attach("Attach a project folder (read-only)");

    expect(store.getState().projectRoots).toEqual(["/picked/api", "/picked/web"]);
    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.getByText("web")).toBeInTheDocument();
    // No session row yet (a brand-new chat), so there is nothing to write to —
    // the roots are carried in the pane until `createSession` writes them.
    expect(db.setProjectRoots).not.toHaveBeenCalled();
  });

  // The bug this pins: the main pane was rendered without `sessionId` (only
  // SidePanel passed it), so every attach/detach in the main pane updated the
  // pane store alone — the session store and the DB never saw the folders, and
  // an added folder vanished on the next session load.
  it("persists the whole list to the session it belongs to", async () => {
    openDialog.mockResolvedValue(["/picked/api", "/picked/web"]);
    useSessionStore.setState({
      chatSessions: [{ id: "s1", projectRoots: [] }],
    });
    const store = createChatStore("attach-session");
    render(<ChatPane store={store} sessionId="s1" />);

    await attach("Attach a project folder (read-only)");

    expect(db.setProjectRoots).toHaveBeenCalledWith("s1", [
      "/picked/api",
      "/picked/web",
    ]);
  });

  it("persists a detach too", () => {
    useSessionStore.setState({
      chatSessions: [{ id: "s1", projectRoots: ["/picked/api", "/picked/web"] }],
    });
    const store = createChatStore("detach-session");
    render(<ChatPane store={store} sessionId="s1" />);
    act(() => store.getState().setProjectRoots(["/picked/api", "/picked/web"]));

    fireEvent.click(screen.getByTitle("Detach web"));

    expect(db.setProjectRoots).toHaveBeenCalledWith("s1", ["/picked/api"]);
  });

  it("adds to what is already attached rather than replacing it", async () => {
    openDialog.mockResolvedValue("/picked/extra");
    const store = createChatStore("attach-append");
    render(<ChatPane store={store} />);
    act(() => store.getState().setProjectRoots(["/existing/api"]));

    await attach("Add another project folder (read-only)");

    expect(store.getState().projectRoots).toEqual([
      "/existing/api",
      "/picked/extra",
    ]);
  });

  it("keeps the accepted folder when another pick is refused", async () => {
    openDialog.mockResolvedValue(["/picked/api", "/home/me"]);
    db.validateProjectRoot.mockImplementation(async (path) => {
      if (path === "/home/me") {
        throw new Error("Refusing to attach your home folder.");
      }
      return path;
    });
    const store = createChatStore("attach-partial");
    render(<ChatPane store={store} />);

    await attach("Attach a project folder (read-only)");

    expect(store.getState().projectRoots).toEqual(["/picked/api"]);
    expect(screen.getByText(/Not attached: me/)).toBeInTheDocument();
  });

  it("detaches one folder without dropping the others", () => {
    const store = createChatStore("detach-one");
    render(<ChatPane store={store} />);
    act(() => store.getState().setProjectRoots(["/picked/api", "/picked/web"]));

    fireEvent.click(screen.getByTitle("Detach web"));

    expect(store.getState().projectRoots).toEqual(["/picked/api"]);
    expect(screen.queryByText("web")).not.toBeInTheDocument();
  });
});
