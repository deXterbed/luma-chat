import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";

// The main pane's props are the wiring under test — capture them instead of
// rendering a real pane (which would need a live store, dialog plugin, etc.).
const renderedPanes = [];
vi.mock("./components/ChatPane", () => ({
  default: (props) => {
    renderedPanes.push(props);
    return null;
  },
}));
vi.mock("./components/Sidebar", () => ({ default: () => null }));
vi.mock("./components/TitleBar", () => ({ default: () => null }));
vi.mock("./lib/ollama", () => ({
  isOllamaReachable: async () => false,
  listLocalModels: async () => [],
}));

import App from "./App";
import { useSessionStore } from "./store/sessionStore";

describe("App wiring", () => {
  beforeEach(() => {
    renderedPanes.length = 0;
    useSessionStore.setState({ activeChatId: null, chatSessions: [] });
  });

  // This regressed silently once: the main pane was rendered without a
  // `sessionId`, so a folder attached there went into the pane store and
  // nowhere else — `ChatPane` guards its session write on that prop. Nothing
  // failed loudly; the folder was just missing after the next session load.
  // `App` kicks off async effects on mount (Ollama reachability, DB hydration),
  // so mounting inside `act` and letting a macrotask drain keeps React's
  // "update not wrapped in act" warnings out of the output.
  const mount = async () => {
    await act(async () => {
      render(<App />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  it("gives the main pane the active session id", async () => {
    useSessionStore.setState({ activeChatId: "session-1" });
    await mount();

    expect(renderedPanes.length).toBeGreaterThan(0);
    // The last render's props: store updates from the mount effects re-render
    // this pane, so only the latest is meaningful.
    const pane = renderedPanes.at(-1);
    expect(pane.store).toBeDefined();
    expect(pane.sessionId).toBe("session-1");
  });

  it("passes no session id for a brand-new chat, so nothing is written to the wrong session", async () => {
    await mount();

    expect(renderedPanes.at(-1).sessionId).toBeNull();
  });
});
