import { describe, it, expect } from "vitest";
import { COMMANDS, matchCommands, expandCommands } from "./commands";

const instruction = (name) => COMMANDS.find((c) => c.name === name).instruction;

describe("COMMANDS", () => {
  it("lists /layman first — it's the palette's default highlight", () => {
    expect(COMMANDS[0].name).toBe("/layman");
  });
});

describe("matchCommands", () => {
  it("returns every command for a bare slash", () => {
    expect(matchCommands("/")).toEqual(COMMANDS);
  });

  it("filters by prefix, case-insensitively", () => {
    expect(matchCommands("/lay").map((c) => c.name)).toEqual(["/layman"]);
    expect(matchCommands("/SUM").map((c) => c.name)).toEqual(["/summarise"]);
  });

  it("returns nothing for an unknown prefix", () => {
    expect(matchCommands("/nope")).toEqual([]);
  });
});

describe("expandCommands", () => {
  it("replaces a bare command with its instruction", () => {
    const out = expandCommands([{ role: "user", content: "/layman" }]);
    expect(out[0].content).toBe(instruction("/layman"));
  });

  it("is case-insensitive", () => {
    const out = expandCommands([{ role: "user", content: "/Layman" }]);
    expect(out[0].content).toBe(instruction("/layman"));
  });

  it("appends text after the command as extra guidance", () => {
    const out = expandCommands([
      { role: "user", content: "/summarise keep it to 3 bullets" },
    ]);
    expect(out[0].content).toBe(
      `${instruction("/summarise")}\n\nkeep it to 3 bullets`,
    );
  });

  it("expands only the last user turn, leaving earlier ones alone", () => {
    const out = expandCommands([
      { role: "user", content: "/summarise" },
      { role: "assistant", content: "…" },
      { role: "user", content: "/layman" },
    ]);
    expect(out[0].content).toBe("/summarise");
    expect(out[2].content).toBe(instruction("/layman"));
  });

  it("leaves non-command and malformed messages untouched", () => {
    const plain = [{ role: "user", content: "just a question" }];
    expect(expandCommands(plain)).toBe(plain);

    // A slash command that isn't ours, and a command-ish word mid-sentence.
    const unknown = [{ role: "user", content: "/unknown thing" }];
    expect(expandCommands(unknown)[0].content).toBe("/unknown thing");

    const midSentence = [{ role: "user", content: "say /layman please" }];
    expect(expandCommands(midSentence)[0].content).toBe("say /layman please");

    const noUser = [{ role: "assistant", content: "/layman" }];
    expect(expandCommands(noUser)).toBe(noUser);
  });

  it("does not mutate the input array", () => {
    const msgs = [{ role: "user", content: "/summarise" }];
    expandCommands(msgs);
    expect(msgs[0].content).toBe("/summarise");
  });
});
