const cheerio = require("cheerio");
const { VirtualConsole } = require("jsdom");

const silentVirtualConsole = new VirtualConsole();
silentVirtualConsole.on("error", () => {});
silentVirtualConsole.on("warn", () => {});
silentVirtualConsole.on("jsdomError", () => {});

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function htmlToReadableText($) {
  const out = [];

  $("body")
    .find("*")
    .each((i, el) => {
      const $el = $(el);
      const tag = el.tagName?.toLowerCase();
      if (!tag) return;

      if (/^h[1-6]$/.test(tag)) {
        const level = parseInt(tag[1], 10);
        const text = $el.text().trim();
        if (text) out.push("\n\n" + "#".repeat(level) + " " + text + "\n");
        return;
      }
      if (tag === "p") {
        const text = $el.text().trim();
        if (text) out.push(text + "\n");
        return;
      }
      if (tag === "li") {
        const text = $el.text().trim();
        if (text) out.push("- " + text + "\n");
        return;
      }
      if (tag === "pre") {
        const code = $el.text();
        if (code) out.push("\n```\n" + code + "\n```\n");
        return;
      }
      if (tag === "code") {
        const text = $el.text();
        if (text) out.push("`" + text + "`");
        return;
      }
    });

  return out.join("").replace(/\n{3,}/g, "\n\n").trim();
}

module.exports = { USER_AGENT, silentVirtualConsole, htmlToReadableText };
