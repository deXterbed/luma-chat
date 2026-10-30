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
    expect(onSend).toHaveBeenCalledWith("/summarise", [], []);
  });

  it("highlights the first command by default", () => {
    const { textarea, onSend } = setup();
    type(textarea, "/");
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("/layman", [], []);
  });

  it("ArrowDown moves the highlight off the first command", () => {
    const { textarea, onSend } = setup();
    type(textarea, "/");
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("/summarise", [], []);
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
    expect(onSend).toHaveBeenCalledWith("/summarise keep it short", [], []);
  });

  it("Escape dismisses the palette and Enter then sends the raw command", () => {
    const { textarea, onSend, queryByText } = setup();
    type(textarea, "/summarise");
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(queryByText(DESC_SUMMARISE)).not.toBeInTheDocument();
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("/summarise", [], []);
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
    expect(onSend).toHaveBeenCalledWith("@zzz", [], []);
  });

  it("does nothing on @ when no project folder is attached", async () => {
    const { textarea } = setup({ codebase: false, projectRoots: [] });
    await type(textarea, "@ap");
    expect(screen.queryByText("src/app.ts")).not.toBeInTheDocument();
  });
});

// ── Attachments ──
//
// Two lanes: images go to Ollama as base64, text-like files are read in the
// renderer and sent as this turn's context. `accept` is only a hint (macOS
// greys the wrong types out, WebView2's dialog and paste do not), so the filter
// in InputArea is the real gate, and a pick it drops has to say so.
describe("InputArea attachments", () => {
  beforeEach(() => {
    // jsdom has no createObjectURL; the preview URL is irrelevant here.
    global.URL.createObjectURL = vi.fn(() => "blob:preview");
    global.URL.revokeObjectURL = vi.fn();
  });

  const setup = () => {
    const onSend = vi.fn();
    const utils = render(<InputArea onSend={onSend} isStreaming={false} />);
    return {
      onSend,
      input: utils.container.querySelector('input[type="file"]'),
      ...utils,
    };
  };

  const file = (name, type = "", content = "x") =>
    new File([content], name, { type });

  // `files` is a getter-only accessor on <input type="file">, so fireEvent's
  // target assignment can't set it; define it on the element first.
  const pick = (input, files) => {
    Object.defineProperty(input, "files", { value: files, configurable: true });
    return act(async () => {
      fireEvent.change(input);
    });
  };

  it("offers images and text files in the dialog", () => {
    const { input } = setup();
    expect(input.accept).toContain("image/png");
    expect(input.accept).toContain(".md");
    expect(input.accept).toContain(".csv");
    // The wildcard also offers SVG and HEIC, which Ollama cannot decode.
    expect(input.accept).not.toContain("image/*");
  });

  it("attaches a supported image without complaining", async () => {
    const { input, queryByRole } = setup();
    await pick(input, [file("shot.png", "image/png")]);
    // FileReader resolves on a later tick, so poll rather than assert inline.
    expect(await screen.findByAltText("shot.png")).toBeInTheDocument();
    expect(queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sends a text file with the message, not as the message", async () => {
    const { input, onSend } = setup();
    await pick(input, [file("notes.md", "", "# Hello")]);
    expect(await screen.findByText("notes.md")).toBeInTheDocument();

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "summarise this" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("summarise this", [], [
      { name: "notes.md", content: "# Hello" },
    ]);
  });

  it("allows a file-only send, since the bubble shows the chip", async () => {
    const { input, onSend } = setup();
    await pick(input, [file("rows.csv", "", "a,b\n1,2")]);
    expect(await screen.findByText("rows.csv")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Send (Enter)"));
    expect(onSend).toHaveBeenCalledWith("", [], [
      { name: "rows.csv", content: "a,b\n1,2" },
    ]);
  });

  it("reports an unsupported type instead of dropping it silently", async () => {
    const { input, findByRole } = setup();
    await pick(input, [file("notes.pdf", "application/pdf")]);
    expect((await findByRole("alert")).textContent).toMatch(
      /notes\.pdf[^:]*: only images, and text, code, CSV, JSON or Markdown/,
    );
    expect(screen.queryByAltText("notes.pdf")).not.toBeInTheDocument();
  });

  it("rejects a HEIC, which matches image/* but can't be decoded", async () => {
    const { input, findByRole } = setup();
    await pick(input, [file("IMG_0001.HEIC", "image/heic")]);
    expect((await findByRole("alert")).textContent).toMatch(/IMG_0001\.HEIC/);
  });

  it("rejects an oversized text file", async () => {
    const { input, findByRole } = setup();
    await pick(input, [file("huge.log", "", "x".repeat(200_000))]);
    expect((await findByRole("alert")).textContent).toMatch(/huge\.log.*100 KB/);
    expect(screen.queryByText("huge.log")).not.toBeInTheDocument();
  });

  it("collects every rejection into one notice", async () => {
    const { input, findByRole } = setup();
    await pick(input, [
      file("a.pdf", "application/pdf"),
      file("b.svg", "image/svg+xml"),
    ]);
    expect((await findByRole("alert")).textContent).toMatch(/\+1 more/);
  });

  it("keeps the accepted files when another file in the pick is refused", async () => {
    const { input, findByRole } = setup();
    await pick(input, [
      file("good.md", "", "# ok"),
      file("bad.pdf", "application/pdf"),
    ]);
    expect(await screen.findByText("good.md")).toBeInTheDocument();
    expect((await findByRole("alert")).textContent).toMatch(/bad\.pdf/);
  });

  it("lets a removed text file be detached before sending", async () => {
    const { input, onSend } = setup();
    await pick(input, [file("notes.md", "", "# Hello")]);
    fireEvent.click(await screen.findByTitle("Remove notes.md"));
    expect(screen.queryByText("notes.md")).not.toBeInTheDocument();

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "hi" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("hi", [], []);
  });

  it("reports a pasted image of an unsupported type", async () => {
    setup();
    const item = {
      type: "image/heic",
      getAsFile: () => file("pasted.HEIC", "image/heic"),
    };
    await act(async () => {
      fireEvent.paste(screen.getByRole("textbox"), {
        clipboardData: { items: [item] },
      });
    });
    expect((await screen.findByRole("alert")).textContent).toMatch(/that file/);
  });

  it("leaves a plain text paste alone, so copying still works", () => {
    const { queryByRole } = setup();
    fireEvent.paste(screen.getByRole("textbox"), {
      clipboardData: { items: [{ type: "text/plain", getAsFile: () => null }] },
    });
    expect(queryByRole("alert")).not.toBeInTheDocument();
  });
});
