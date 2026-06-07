const cheerio = require("cheerio");
const { Readability } = require("@mozilla/readability");
const { JSDOM } = require("jsdom");
const {
  USER_AGENT,
  silentVirtualConsole,
  htmlToReadableText,
} = require("./html");

async function fetchPage(url) {
  if (!url || typeof url !== "string") {
    return "Error: url must be a non-empty string";
  }

  let parsed;
  try {
    parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "Error: only http and https URLs are supported";
    }
  } catch {
    return "Error: invalid URL";
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let res;
    try {
      res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
        },
        redirect: "follow",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      if (res.status === 404 || res.status === 410) {
        return `Error: fetch failed with HTTP ${res.status} (Not Found). The URL ${url} is invalid or no longer exists. Try a different URL from prior search results, or answer based on the search snippets alone.`;
      }
      return `Error: fetch failed (HTTP ${res.status} ${res.statusText})`;
    }

    const contentType = res.headers.get("content-type") || "";
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml")
    ) {
      return `Error: not an HTML page (content-type: ${contentType})`;
    }

    const html = await res.text();
    const dom = new JSDOM(html, { url, virtualConsole: silentVirtualConsole });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    let sourceHtml = article?.content ?? null;
    let title = article?.title ?? "";

    if (!sourceHtml) {
      // Readability fallback: strip chrome, grab main content container
      const $raw = cheerio.load(html);
      $raw(
        "script, style, nav, header, footer, aside, [role='navigation']",
      ).remove();
      const main = $raw(
        "main, article, [role='main'], .content, #content, #main",
      ).first();
      sourceHtml = (main.length ? main : $raw("body")).html() || "";
      title = $raw("title").text().trim();
    }

    const $ = cheerio.load(sourceHtml);
    const text = htmlToReadableText($);

    if (!text || text.length < 50) {
      return "Error: could not extract readable content from page";
    }

    const links = [];
    $("a[href]").each((i, el) => {
      const href = $(el).attr("href");
      const linkText = $(el).text().trim();
      if (href && linkText && links.length < 20) {
        try {
          const abs = new URL(href, url).toString();
          links.push({ text: linkText.slice(0, 100), url: abs });
        } catch {}
      }
    });

    return JSON.stringify({
      httpStatus: res.status,
      title,
      url,
      content: text.slice(0, 8000),
      links,
    });
  } catch (err) {
    return `Error: fetch failed (${err.message || err})`;
  }
}

module.exports = { fetchPage };
