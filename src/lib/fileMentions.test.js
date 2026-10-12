import { describe, it, expect, vi } from "vitest";
import {
  activeMention,
  parseMentions,
  insertMention,
  buildMentionContext,
  MENTION_READ_LIMIT,
} from "./fileMentions";

describe("activeMention", () => {
  it("finds the token at the caret", () => {
    // "look at @src/ap" — the @ is at 8, the caret after the last char is 15.
    expect(activeMention("look at @src/ap", 15)).toEqual({
      start: 8,
      end: 15,
      query: "src/ap",
    });
  });

  it("opens on a bare @", () => {
    expect(activeMention("@", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  it("ignores an @ preceded by a non-space", () => {
    // `foo@bar` is an email-ish token, not a file reference.
    expect(activeMention("foo@bar", 7)).toBeNull();
  });

  it("ignores a nested @ inside an existing token", () => {
    // The npm-package case from codex #12643.
    expect(activeMention("npx -y @scope/pkg@latest", 24)).toBeNull();
  });

  it("still completes the first @ of an npm-shaped token", () => {
    expect(activeMention("npx -y @scope/pkg", 17)).toEqual({
      start: 7,
      end: 17,
      query: "scope/pkg",
    });
  });

  it("closes once whitespace follows the @", () => {
    expect(activeMention("@src/app.ts done", 17)).toBeNull();
  });

  it("keys off the token nearest the caret", () => {
    expect(activeMention("@first @sec", 11)).toEqual({
      start: 7,
      end: 11,
      query: "sec",
    });
  });

  it("allows spaces inside a quoted token", () => {
    expect(activeMention('@"my file', 9)).toEqual({
      start: 0,
      end: 9,
      query: "my file",
    });
  });

  it("closes after a quoted token's closing quote", () => {
    // Otherwise the space we insert after a pick would reopen the popup.
    expect(activeMention('@"my file.ts" ', 14)).toBeNull();
  });

  it("returns null for a non-string or an out-of-range caret", () => {
    expect(activeMention(undefined, 0)).toBeNull();
    expect(activeMention("@a", 99)).toBeNull();
  });

  it("returns null for a caret before the @", () => {
    expect(activeMention("@a", 0)).toBeNull();
  });
});

describe("parseMentions", () => {
  it("extracts root-relative paths", () => {
    expect(parseMentions("explain @src/app.ts please")).toEqual([
      { root: undefined, path: "src/app.ts" },
    ]);
  });

  it("ignores mid-word @ and npm-style packages", () => {
    expect(parseMentions("mail foo@bar and run @scope/pkg@latest")).toEqual([]);
  });

  it("reads a quoted path as one mention", () => {
    expect(parseMentions('read @"my file.ts" now')).toEqual([
      { root: undefined, path: "my file.ts" },
    ]);
  });

  it("splits the alias off when more than one root is attached", () => {
    expect(parseMentions("see @web:src/app.ts", { multiRoot: true })).toEqual([
      { root: "web", path: "src/app.ts" },
    ]);
  });

  it("keeps a parent-qualified alias intact", () => {
    expect(
      parseMentions("see @work/api:tickets.rb", { multiRoot: true }),
    ).toEqual([{ root: "work/api", path: "tickets.rb" }]);
  });

  it("treats a colon as part of the path when only one root is attached", () => {
    expect(parseMentions("@a:b.ts")).toEqual([{ root: undefined, path: "a:b.ts" }]);
  });

  it("returns every mention in order", () => {
    expect(parseMentions("@a.ts then @b.ts")).toEqual([
      { root: undefined, path: "a.ts" },
      { root: undefined, path: "b.ts" },
    ]);
  });

  it("drops trailing prose punctuation from an unquoted path", () => {
    expect(parseMentions("look at @src/app.ts, then", {})).toEqual([
      { root: undefined, path: "src/app.ts" },
    ]);
    expect(parseMentions("see @a.ts.")).toEqual([
      { root: undefined, path: "a.ts" },
    ]);
  });

  it("keeps punctuation inside a quoted path verbatim", () => {
    expect(parseMentions('@"odd, name.ts"')).toEqual([
      { root: undefined, path: "odd, name.ts" },
    ]);
  });
});

describe("insertMention", () => {
  it("replaces the token it was found in", () => {
    const text = "look at @src/ap now";
    const mention = activeMention(text, 15);
    expect(insertMention(text, mention, "src/app.ts")).toEqual({
      text: "look at @src/app.ts  now",
      caret: 20,
    });
  });

  it("quotes a path containing a space", () => {
    const text = "@my";
    const mention = activeMention(text, 3);
    expect(insertMention(text, mention, "my file.ts")).toEqual({
      text: '@"my file.ts" ',
      caret: 14,
    });
  });
});

describe("buildMentionContext", () => {
  it("returns null when the message references nothing", async () => {
    const readFile = vi.fn();
    expect(await buildMentionContext({ text: "hello", readFile })).toBeNull();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("reads each mention and labels the block", async () => {
    const readFile = vi.fn(async (path) => `1→${path}\n`);
    const ctx = await buildMentionContext({
      text: "compare @a.ts and @b.ts",
      readFile,
    });
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(readFile).toHaveBeenNthCalledWith(1, "a.ts", undefined, {
      limit: MENTION_READ_LIMIT,
    });
    expect(ctx.content).toContain("--- a.ts ---");
    expect(ctx.content).toContain("--- b.ts ---");
    expect(ctx.content).toContain("do not read them again");
    expect(ctx.calls).toBe(2);
    expect(ctx.bytes).toBeGreaterThan(0);
  });

  // One mention must not be able to take the run's whole file budget, so the
  // read is bounded rather than paged by the model afterwards.
  it("bounds each mention's read", async () => {
    const readFile = vi.fn(async () => "x");
    await buildMentionContext({ text: "@a.ts", readFile });
    const [, , options] = readFile.mock.calls[0];
    expect(options.limit).toBe(MENTION_READ_LIMIT);
    expect(options.limit).toBeLessThan(2000);
  });

  it("passes the alias through as the root", async () => {
    const readFile = vi.fn(async () => "x");
    await buildMentionContext({
      text: "@web:src/app.ts",
      multiRoot: true,
      readFile,
    });
    expect(readFile.mock.calls[0][0]).toBe("src/app.ts");
    expect(readFile.mock.calls[0][1]).toBe("web");
  });

  it("stops spending once the byte budget is reached", async () => {
    // Budget already spent: the first read is still attempted (the check is
    // before the call, and bytes start at 0), the second is not.
    const readFile = vi.fn(async () => "x".repeat(100));
    await buildMentionContext({
      text: "@a.ts @b.ts @c.ts",
      readFile,
      maxBytes: 100,
    });
    expect(readFile).toHaveBeenCalledTimes(1);
  });
});
