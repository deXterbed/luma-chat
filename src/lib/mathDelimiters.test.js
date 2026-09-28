import { describe, it, expect } from "vitest";
import { normalizeMathDelimiters } from "./mathDelimiters";

describe("normalizeMathDelimiters", () => {
  it("upgrades unambiguous inline `$...$` math to `$$...$$`", () => {
    expect(normalizeMathDelimiters("one of $2^n$ distinct patterns")).toBe(
      "one of $$2^n$$ distinct patterns",
    );
    expect(normalizeMathDelimiters("$2^3 = 8$ patterns")).toBe(
      "$$2^3 = 8$$ patterns",
    );
    expect(normalizeMathDelimiters("only $n = 4$ gives a bijection")).toBe(
      "only $$n = 4$$ gives a bijection",
    );
  });

  it("leaves literal currency dollar signs alone", () => {
    // From CLAUDE.md's example: remark-math would pair the two `$` up and eat
    // the text between them if single-dollar math were enabled globally.
    const currency = "**$40 per 100GB** ($0.40/GB)";
    expect(normalizeMathDelimiters(currency)).toBe(currency);
    expect(normalizeMathDelimiters("costs $5 and $10")).toBe("costs $5 and $10");
    expect(normalizeMathDelimiters("$1,000 to $2,000")).toBe(
      "$1,000 to $2,000",
    );
    // A closing `$` followed by a digit is currency, not math.
    expect(normalizeMathDelimiters("$5-$10")).toBe("$5-$10");
  });

  it("does not touch `$$...$$` display math", () => {
    expect(normalizeMathDelimiters("Inline $$E=mc^2$$ and block:\n\n$$E=mc^2$$")).toBe(
      "Inline $$E=mc^2$$ and block:\n\n$$E=mc^2$$",
    );
  });

  it("rewrites the CommonMark-escaped `\\( \\)` / `\\[ \\]` forms", () => {
    expect(normalizeMathDelimiters("a \\(x+1\\) b")).toBe("a $$x+1$$ b");
    expect(normalizeMathDelimiters("\\[y^2\\]")).toBe("$$y^2$$");
  });

  it("skips fenced and inline code", () => {
    expect(normalizeMathDelimiters("```\n$x$ \\[a\\]\n```")).toBe(
      "```\n$x$ \\[a\\]\n```",
    );
    expect(normalizeMathDelimiters("run `$x$` now")).toBe("run `$x$` now");
  });

  it("leaves escaped dollars alone", () => {
    expect(normalizeMathDelimiters("\\$5 \\$6")).toBe("\\$5 \\$6");
  });
});
