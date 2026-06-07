// Web tools for the research workbench: search and fetch.
// These run in the Electron main process (not the renderer) so that:
//   1. We can use Node-only libraries (cheerio, readability)
//   2. Network code is in one auditable place
//   3. The renderer doesn't hit CORS or expose scraping logic
//
// All functions return strings suitable for use as `role: "tool"` content
// in the Ollama API. Errors are returned as human-readable strings (not
// thrown) so the model can adapt its response.

const cheerio = require('cheerio');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');

// Realistic User-Agent — some sites (including DDG) block empty or
// default UAs. This is a recent Chrome on macOS.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const DDG_HTML_ENDPOINT = 'https://html.duckduckgo.com/html/';

// =============================================================================
// web_search — DuckDuckGo HTML scrape
// =============================================================================

/**
 * Search the web via DuckDuckGo's HTML endpoint. Returns a JSON string
 * with title, url, snippet for each result.
 *
 * @param {string} query
 * @param {number} [maxResults=5]
 * @returns {Promise<string>} JSON-encoded array of results, or error string
 */
async function searchWeb(query, maxResults = 5) {
  if (!query || typeof query !== 'string') {
    return 'Error: query must be a non-empty string';
  }
  const limit = Math.max(1, Math.min(10, maxResults));

  try {
    // DDG's HTML endpoint accepts POST with form data. q= is the query.
    const body = new URLSearchParams({ q: query, kl: 'us-en' });
    const res = await fetch(DDG_HTML_ENDPOINT, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html',
      },
      body: body.toString(),
    });

    if (!res.ok) {
      return `Error: search request failed (HTTP ${res.status})`;
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    const results = [];
    // DDG's result selectors. The HTML endpoint uses `.result` containers
    // with `.result__a` for the title/link and `.result__snippet` for
    // the excerpt. We also try a few fallback selectors in case DDG
    // changes their markup.
    $('.result').each((i, el) => {
      if (results.length >= limit) return false;

      const $el = $(el);
      const $link = $el.find('.result__a').first();
      const $snippet = $el.find('.result__snippet').first();

      if ($link.length === 0) return; // skip ads / non-result rows

      const rawHref = $link.attr('href') || '';
      const title = $link.text().trim();
      const snippet = $snippet.text().trim();

      // DDG wraps result URLs in a redirect. Extract the actual uddg=
      // parameter which contains the real destination URL.
      const url = extractRealUrl(rawHref);

      if (!title || !url) return; // skip malformed rows

      results.push({ title, url, snippet });
    });

    if (results.length === 0) {
      return 'No results found. Try a more specific query.';
    }

    return JSON.stringify(results);
  } catch (err) {
    return `Error: search failed (${err.message || err})`;
  }
}

/**
 * DDG wraps result URLs in a redirect like:
 *   //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Farticle&...
 * Extract the real destination URL from the `uddg` parameter.
 */
function extractRealUrl(href) {
  if (!href) return '';
  try {
    // If it's already a full URL, try to extract uddg
    if (href.startsWith('//')) href = 'https:' + href;
    if (href.startsWith('http')) {
      const u = new URL(href);
      const uddg = u.searchParams.get('uddg');
      if (uddg) return decodeURIComponent(uddg);
      // No uddg — it's already a direct URL (rare for DDG HTML)
      return u.toString();
    }
    // Relative URL (rare) — return as-is
    return href;
  } catch {
    return '';
  }
}

// =============================================================================
// web_fetch — fetch a URL and extract readable content
// =============================================================================

/**
 * Fetch a URL and extract the main readable content using Mozilla
 * Readability. Returns a JSON string with title, url, content (markdown),
 * and links found on the page.
 *
 * @param {string} url
 * @returns {Promise<string>} JSON-encoded fetch result, or error string
 */
async function fetchPage(url) {
  if (!url || typeof url !== 'string') {
    return 'Error: url must be a non-empty string';
  }

  // Basic URL validation
  let parsed;
  try {
    parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return 'Error: only http and https URLs are supported';
    }
  } catch {
    return 'Error: invalid URL';
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    if (!res.ok) {
      return `Error: fetch failed (HTTP ${res.status})`;
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return `Error: not an HTML page (content-type: ${contentType})`;
    }

    const html = await res.text();

    // JSDOM + Readability: parse the HTML into a DOM, then extract the
    // main article. Readability gives us { title, content (HTML), ... }
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) {
      return 'Error: could not extract readable content from page';
    }

    // Convert the HTML content to readable markdown-ish text.
    // cheerio.load gives us a $ we can use to walk and convert.
    const $ = cheerio.load(article.content);
    const text = htmlToReadableText($);

    // Also extract any links the article referenced — useful for
    // follow-up research.
    const links = [];
    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (href && text && links.length < 20) {
        try {
          const abs = new URL(href, url).toString();
          links.push({ text: text.slice(0, 100), url: abs });
        } catch {
          // skip invalid URLs
        }
      }
    });

    return JSON.stringify({
      title: article.title || '',
      url,
      content: text.slice(0, 8000), // cap to keep token usage bounded
      links,
    });
  } catch (err) {
    return `Error: fetch failed (${err.message || err})`;
  }
}

/**
 * Convert cheerio-parsed article HTML to a clean readable text format.
 * Preserves basic structure (headings, lists, code blocks) without
 * emitting HTML tags.
 */
function htmlToReadableText($) {
  const out = [];

  $('body')
    .find('*')
    .each((i, el) => {
      const $el = $(el);
      const tag = el.tagName?.toLowerCase();
      if (!tag) return;

      // Headings → "## text"
      if (/^h[1-6]$/.test(tag)) {
        const level = parseInt(tag[1], 10);
        const text = $el.text().trim();
        if (text) {
          out.push('\n\n' + '#'.repeat(level) + ' ' + text + '\n');
        }
        return;
      }

      // Paragraphs → blank-line-separated text
      if (tag === 'p') {
        const text = $el.text().trim();
        if (text) out.push(text + '\n');
        return;
      }

      // Lists → "- text" per item
      if (tag === 'li') {
        const text = $el.text().trim();
        if (text) out.push('- ' + text + '\n');
        return;
      }

      // Code blocks (pre > code) → fenced
      if (tag === 'pre') {
        const code = $el.text();
        if (code) out.push('\n```\n' + code + '\n```\n');
        return;
      }

      // Inline code → backticked
      if (tag === 'code') {
        const text = $el.text();
        if (text) out.push('`' + text + '`');
        return;
      }
    });

  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { searchWeb, fetchPage };
