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
