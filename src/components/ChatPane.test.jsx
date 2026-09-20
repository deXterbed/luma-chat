import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import ChatPane from "./ChatPane";
import { createChatStore } from "../store/chatStore";
import { useSessionStore } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";

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
