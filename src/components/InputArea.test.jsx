import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import InputArea from "./InputArea";

// The slash-command palette: opens on a bare `/token`, navigates with the
// arrows, sends on Enter, completes in place on Tab. The command -> instruction
// expansion the model actually sees is covered in lib/commands.test.js.
//
// Presence is asserted via the description strings ("Summarise this…"), not the
// command names: RTL's text queries also match a <textarea> whose *value* is the
// command, so a name query finds the input itself and proves nothing.
const DESC_SUMMARISE = "Summarise this conversation so far";
function setup() {
  const onSend = vi.fn();
  const utils = render(<InputArea onSend={onSend} isStreaming={false} />);
  const textarea = utils.container.querySelector("textarea");
  return { onSend, textarea, ...utils };
}

const type = (textarea, value) =>
  fireEvent.change(textarea, { target: { value } });

describe("InputArea slash-command palette", () => {
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
