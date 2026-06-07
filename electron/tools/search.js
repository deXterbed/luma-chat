const cheerio = require("cheerio");
const { USER_AGENT } = require("./html");

const DDG_HTML_ENDPOINT = "https://html.duckduckgo.com/html/";

async function searchWeb(query, maxResults = 5) {
  if (!query || typeof query !== "string") {
    return "Error: query must be a non-empty string";
  }
  const limit = Math.max(1, Math.min(10, maxResults));

  try {
    const body = new URLSearchParams({ q: query, kl: "us-en" });
    const res = await fetch(DDG_HTML_ENDPOINT, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/html",
      },
      body: body.toString(),
    });

    if (!res.ok) {
      return `Error: search request failed (HTTP ${res.status})`;
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    const results = [];
    $(".result").each((i, el) => {
      if (results.length >= limit) return false;
      const $el = $(el);
      const $link = $el.find(".result__a").first();
      const $snippet = $el.find(".result__snippet").first();
      if ($link.length === 0) return;

      const rawHref = $link.attr("href") || "";
      const title = $link.text().trim();
      const snippet = $snippet.text().trim();
      const url = extractRealUrl(rawHref);

      if (!title || !url) return;
      results.push({ title, url, snippet });
    });

    if (results.length === 0) {
      return "No results found. Try a more specific query.";
    }

    return JSON.stringify(results);
  } catch (err) {
    return `Error: search failed (${err.message || err})`;
  }
}

function extractRealUrl(href) {
  if (!href) return "";
  try {
    if (href.startsWith("//")) href = "https:" + href;
    if (href.startsWith("http")) {
      const u = new URL(href);
      const uddg = u.searchParams.get("uddg");
      if (uddg) return decodeURIComponent(uddg);
      return u.toString();
    }
    return href;
  } catch {
    return "";
  }
}

module.exports = { searchWeb };
