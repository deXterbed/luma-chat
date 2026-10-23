import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../hooks/useDragResize", () => ({
  useDragResize: () => ({ width: 220, onMouseDown: () => {} }),
}));

import Sidebar from "./Sidebar";
import { useSessionStore } from "../store/sessionStore";

const sessions = [
  { id: "s1", title: "Alpha project", model: "m", messages: [] },
  { id: "s2", title: "Beta notes", model: "m", messages: [] },
];

const searchInput = () => screen.getByLabelText("Search chats");

describe("Sidebar search", () => {
  beforeEach(() => {
    useSessionStore.setState({ chatSessions: sessions, activeChatId: null });
  });

  it("filters the chat list by title", () => {
    render(<Sidebar />);
    expect(screen.getByText("Alpha project")).toBeInTheDocument();
    expect(screen.getByText("Beta notes")).toBeInTheDocument();

    fireEvent.change(searchInput(), { target: { value: "alpha" } });

    expect(screen.getByText("Alpha project")).toBeInTheDocument();
    expect(screen.queryByText("Beta notes")).not.toBeInTheDocument();
  });

  it("matches case-insensitively", () => {
    render(<Sidebar />);
    fireEvent.change(searchInput(), { target: { value: "BETA" } });

    expect(screen.getByText("Beta notes")).toBeInTheDocument();
    expect(screen.queryByText("Alpha project")).not.toBeInTheDocument();
  });

  it("shows a hint when nothing matches", () => {
    render(<Sidebar />);
    fireEvent.change(searchInput(), { target: { value: "gamma" } });

    expect(screen.getByText("No chats match your search.")).toBeInTheDocument();
  });

  it("clears the query and restores every chat", () => {
    render(<Sidebar />);
    fireEvent.change(searchInput(), { target: { value: "alpha" } });
    fireEvent.click(screen.getByLabelText("Clear search"));

    expect(searchInput().value).toBe("");
    expect(screen.getByText("Beta notes")).toBeInTheDocument();
  });
});
