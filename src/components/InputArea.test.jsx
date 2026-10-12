import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import InputArea from "./InputArea";
import { db } from "../lib/db";

// ── Slash-command palette ──
//
// It opens on a bare `/token`, navigates with the arrows, sends on Enter, and
// completes in place on Tab. The command -> instruction expansion the model
// actually sees is covered in lib/commands.test.js.
//
// Presence is asserted via the description strings ("Summarise this…"), not the
// command names: RTL's text queries also match a <textarea> whose *value* is the
// command, so a name query finds the input itself and proves nothing.
const DESC_SUMMARISE = "Summarise this conversation so far";

describe("InputArea slash-command palette", () => {
  const setup = () => {
    const onSend = vi.fn();
    const utils = render(<InputArea onSend={onSend} isStreaming={false} />);
    const textarea = utils.container.querySelector("textarea");
    return { onSend, textarea, ...utils };
  };

  const type = (textarea, value) =>
    fireEvent.change(textarea, { target: { value } });

  it("opens on a bare slash and lists the commands", () => {
    const { textarea, getByText } = setup();
    type(textarea, "/");
    expect(getByText(DESC_SUMMARISE)).toBeInTheDocument();
    expect(getByText("Explain your last answer in plain language")).toBeInTheDocument();
  });

  it("sends the highlighted command on Enter", () => {
    const { textarea, onSend } = setup();
    type(textarea, "/sum");
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("/summarise", []);
  });

  it("highlights the first command by default", () => {
    const { textarea, onSend } = setup();
    type(textarea, "/");
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("/layman", []);
  });

  it("ArrowDown moves the highlight off the first command", () => {
    const { textarea, onSend } = setup();
    type(textarea, "/");
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("/summarise", []);
  });

  it("Tab completes in place without sending, so args can be added", () => {
    const { textarea, onSend } = setup();
    type(textarea, "/lay");
    fireEvent.keyDown(textarea, { key: "Tab" });
    expect(onSend).not.toHaveBeenCalled();
    expect(textarea.value).toBe("/layman ");
  });

  it("closes the palette once a space is typed, so Enter sends the raw text", () => {
    const { textarea, onSend, queryByText } = setup();
    type(textarea, "/summarise keep it short");
    expect(queryByText(DESC_SUMMARISE)).not.toBeInTheDocument();
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("/summarise keep it short", []);
  });

  it("Escape dismisses the palette and Enter then sends the raw command", () => {
    const { textarea, onSend, queryByText } = setup();
    type(textarea, "/summarise");
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(queryByText(DESC_SUMMARISE)).not.toBeInTheDocument();
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("/summarise", []);
  });

  it("shows no palette for an unknown prefix", () => {
    const { textarea, queryByText } = setup();
    type(textarea, "/nope");
    expect(queryByText(DESC_SUMMARISE)).not.toBeInTheDocument();
  });
});

// ── @-mention autocomplete ──
//
// The picker is driven through the textarea, the way a user drives it.
// `listProjectFiles` is mocked; the module-level index cache is keyed by the
// root set, so every test here shares one root path and one file list.
describe("InputArea @-mention autocomplete", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(db, "listProjectFiles").mockResolvedValue([
      "src/app.ts",
      "src/lib/db.rs",
      "README.md",
    ]);
  });

  const setup = (props = {}) => {
    const onSend = vi.fn();
    render(
      <InputArea
        onSend={onSend}
        isStreaming={false}
        codebase
        projectRoots={["/tmp/luma-inputarea"]}
        {...props}
      />,
    );
    return { onSend, textarea: screen.getByRole("textbox") };
  };

  const type = async (textarea, value) => {
    await act(async () => {
      fireEvent.change(textarea, { target: { value } });
    });
  };

  it("opens on @ and inserts the clicked path", async () => {
    const { textarea } = setup();
    await type(textarea, "@");
    fireEvent.click(await screen.findByText("src/app.ts"));
    expect(textarea.value).toBe("@src/app.ts ");
  });

  it("filters as you type and inserts the match with Enter", async () => {
    const { onSend, textarea } = setup();
    await type(textarea, "@ap");
    await screen.findByText("src/app.ts");
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();

    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(textarea.value).toBe("@src/app.ts ");
    // Enter must complete the path, not send the message (codex #701 review).
    expect(onSend).not.toHaveBeenCalled();
  });

  it("moves the highlight with the arrow keys", async () => {
    const { textarea } = setup();
    await type(textarea, "@");
    await screen.findByText("src/app.ts");
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(textarea.value).toBe("@src/lib/db.rs ");
  });

  it("closes on Escape without sending or inserting", async () => {
    const { onSend, textarea } = setup();
    await type(textarea, "@");
    await screen.findByText("src/app.ts");

    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.queryByText("src/app.ts")).not.toBeInTheDocument();
    expect(textarea.value).toBe("@");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("sends on Enter when the reference matches no file", async () => {
    const { onSend, textarea } = setup();
    await type(textarea, "@zzz");
    expect(screen.queryByText("src/app.ts")).not.toBeInTheDocument();

    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("@zzz", []);
  });

  it("does nothing on @ when no project folder is attached", async () => {
    const { textarea } = setup({ codebase: false, projectRoots: [] });
    await type(textarea, "@ap");
    expect(screen.queryByText("src/app.ts")).not.toBeInTheDocument();
  });
});
