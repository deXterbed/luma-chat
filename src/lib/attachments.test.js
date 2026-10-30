import { describe, it, expect } from "vitest";
import {
  ACCEPT_ATTRIBUTE,
  MAX_FILE_BYTES,
  attachProblem,
  attachmentKind,
  buildAttachmentBlock,
  fileToText,
  unsupportedNotice,
} from "./attachments";

const file = (name, type = "", content = "x") =>
  new File([content], name, { type });

describe("attachmentKind", () => {
  it("classifies an image by MIME", () => {
    expect(attachmentKind(file("a.png", "image/png"))).toBe("image");
  });

  it("classifies text files by extension when the MIME is empty", () => {
    // Source files have no registered type, so `type` is empty in practice.
    for (const name of ["notes.md", "rows.csv", "data.json", "main.rs"]) {
      expect(attachmentKind(file(name))).toBe("text");
    }
  });

  it("classifies dotfiles and extension-less names", () => {
    expect(attachmentKind(file(".env"))).toBe("text");
    expect(attachmentKind(file(".gitignore"))).toBe("text");
    expect(attachmentKind(file("Dockerfile"))).toBe("text");
    expect(attachmentKind(file("Makefile"))).toBe("text");
  });

  it("falls back to a registered text MIME for unlisted extensions", () => {
    expect(attachmentKind(file("notes.frobnicate", "text/plain"))).toBe("text");
    expect(attachmentKind(file("payload.bin", "application/json"))).toBe(
      "text",
    );
  });

  it("refuses formats it cannot read as text or send as an image", () => {
    expect(attachmentKind(file("doc.pdf", "application/pdf"))).toBeNull();
    // Matches image/* but Ollama can't decode it, so it is not an image here.
    expect(attachmentKind(file("IMG_0001.HEIC", "image/heic"))).toBeNull();
    expect(attachmentKind(file("vector.svg", "image/svg+xml"))).toBeNull();
  });
});

describe("attachProblem", () => {
  it("returns null for a supported file", () => {
    expect(attachProblem(file("notes.md"))).toBeNull();
  });

  it("names the file and the supported kinds when refusing", () => {
    expect(attachProblem(file("doc.pdf", "application/pdf"))).toMatch(
      /doc\.pdf.*text, code, CSV, JSON or Markdown/,
    );
  });

  it("caps text files at MAX_FILE_BYTES", () => {
    const big = file("huge.log", "", "x".repeat(MAX_FILE_BYTES + 1));
    expect(attachProblem(big)).toMatch(/huge\.log.*100 KB/);
  });

  it("does not size-cap images, which vision models already bound", () => {
    const big = file("photo.png", "image/png", "x".repeat(MAX_FILE_BYTES + 1));
    expect(attachProblem(big)).toBeNull();
  });

  it("names an unnamed paste rather than leaving it blank", () => {
    expect(unsupportedNotice(null)).toMatch(/that file/);
  });
});

describe("ACCEPT_ATTRIBUTE", () => {
  it("lists images and text extensions, never the image/* wildcard", () => {
    expect(ACCEPT_ATTRIBUTE).toContain("image/png");
    expect(ACCEPT_ATTRIBUTE).toContain(".md");
    expect(ACCEPT_ATTRIBUTE).toContain(".csv");
    expect(ACCEPT_ATTRIBUTE).not.toContain("image/*");
  });
});

describe("buildAttachmentBlock", () => {
  it("wraps each file with its name and keeps the contents intact", () => {
    const block = buildAttachmentBlock([
      { name: "a.md", content: "# Title" },
      { name: "b.csv", content: "x,y\n1,2" },
    ]);
    expect(block).toContain("--- a.md ---\n# Title");
    expect(block).toContain("--- b.csv ---\nx,y\n1,2");
    expect(block).toMatch(/do not say you cannot see them/);
  });
});

describe("fileToText", () => {
  it("reads the file as UTF-8 text", async () => {
    await expect(fileToText(file("n.md", "", "héllo"))).resolves.toBe("héllo");
  });
});
