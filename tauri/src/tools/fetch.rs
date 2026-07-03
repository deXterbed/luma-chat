use scraper::{Html, Selector};
use serde::Serialize;
use std::time::Duration;

use super::html::{html_to_readable_text, USER_AGENT};

/// Cap on how many bytes of a page body we download. The extracted content is
/// truncated to 8000 chars anyway, so multi-megabyte pages only waste memory
/// and time in the HTML parser (and, before this cap, `res.text()` buffered
/// the entire body unbounded). 2 MB of HTML is far more than enough source
/// material for an 8000-char extract.
const MAX_HTML_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Serialize)]
struct FetchResult {
    #[serde(rename = "httpStatus")]
    http_status: u16,
    title: String,
    url: String,
    content: String,
    links: Vec<Link>,
}

#[derive(Debug, Serialize)]
struct Link {
    text: String,
    url: String,
}

pub async fn fetch_page(url: &str) -> String {
    if url.trim().is_empty() {
        return "Error: url must be a non-empty string".to_string();
    }

    let parsed = match url::Url::parse(url) {
        Ok(u) => u,
        Err(_) => return "Error: invalid URL".to_string(),
    };

    match parsed.scheme() {
        "http" | "https" => {}
        _ => return "Error: only http and https URLs are supported".to_string(),
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .unwrap();

    let mut res = match client
        .get(url)
        .header("User-Agent", USER_AGENT)
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Accept-Encoding", "gzip, deflate, br")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            if e.is_timeout() {
                return format!("Error: fetch timed out after 15s");
            }
            return format!("Error: fetch failed ({})", e);
        }
    };

    let http_status = res.status().as_u16();

    if !res.status().is_success() {
        if http_status == 404 || http_status == 410 {
            return format!(
                "Error: fetch failed with HTTP {} (Not Found). The URL {} is invalid or no longer exists. Try a different URL from prior search results, or answer based on the search snippets alone.",
                http_status, url
            );
        }
        return format!(
            "Error: fetch failed (HTTP {} {})",
            http_status,
            res.status().canonical_reason().unwrap_or("")
        );
    }

    let content_type = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !content_type.contains("text/html") && !content_type.contains("application/xhtml") {
        return format!("Error: not an HTML page (content-type: {})", content_type);
    }

    // Stream the body with a hard size cap instead of `res.text()`, which
    // buffers the entire response unbounded — a huge page (or a hostile
    // endpoint that streams forever) would balloon memory long before the
    // 8000-char content truncation below. Once the cap is hit we stop
    // reading and parse what we have; truncated HTML is fine for both
    // Readability and the fallback extractor.
    let mut body: Vec<u8> = Vec::new();
    loop {
        match res.chunk().await {
            Ok(Some(chunk)) => {
                let remaining = MAX_HTML_BYTES - body.len();
                if chunk.len() >= remaining {
                    body.extend_from_slice(&chunk[..remaining]);
                    break;
                }
                body.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(e) => return format!("Error: failed to read response ({})", e),
        }
    }
    // A capped read can split a multibyte character at the boundary;
    // from_utf8_lossy replaces the fragment instead of failing.
    let html_text = String::from_utf8_lossy(&body).into_owned();

    // Try Readability first
    let (source_html, title) = {
        let mut cursor = std::io::Cursor::new(html_text.as_bytes());
        match readability::extractor::extract(&mut cursor, &parsed) {
            Ok(product) => (product.content, product.title),
            Err(_) => {
                // Fallback: strip chrome, grab main content
                let document = Html::parse_document(&html_text);
                let title = document
                    .select(&Selector::parse("title").unwrap())
                    .next()
                    .map(|t| t.text().collect::<Vec<_>>().join("").trim().to_string())
                    .unwrap_or_default();

                // Remove script, style, nav, header, footer, aside
                let mut html_cleaned = html_text.clone();
                for tag in &["script", "style", "nav", "header", "footer", "aside"] {
                    let open = format!("<{}", tag);
                    let close = format!("</{}>", tag);
                    html_cleaned = strip_tags(&html_cleaned, &open, &close);
                }

                // Try to find main content
                let cleaned_doc = Html::parse_document(&html_cleaned);
                let main_selector =
                    Selector::parse("main, article, [role='main'], .content, #content, #main")
                        .unwrap();

                let main_html = if let Some(main) = cleaned_doc.select(&main_selector).next() {
                    main.inner_html()
                } else {
                    cleaned_doc
                        .select(&Selector::parse("body").unwrap())
                        .next()
                        .map(|b| b.inner_html())
                        .unwrap_or_default()
                };

                (main_html, title)
            }
        }
    };

    let document = Html::parse_fragment(&source_html);
    let text = html_to_readable_text(&document);

    if text.len() < 50 {
        return "Error: could not extract readable content from page".to_string();
    }

    // Extract links
    let mut links: Vec<Link> = Vec::new();
    if let Ok(link_sel) = Selector::parse("a[href]") {
        for el in document.select(&link_sel) {
            if links.len() >= 20 {
                break;
            }
            if let Some(href) = el.value().attr("href") {
                let link_text = el.text().collect::<Vec<_>>().join("").trim().to_string();
                if !link_text.is_empty() {
                    if let Ok(abs) = url::Url::parse(href) {
                        links.push(Link {
                            text: link_text.chars().take(100).collect(),
                            url: abs.to_string(),
                        });
                    } else if let Ok(abs) = parsed.join(href) {
                        links.push(Link {
                            text: link_text.chars().take(100).collect(),
                            url: abs.to_string(),
                        });
                    }
                }
            }
        }
    }

    serde_json::to_string(&FetchResult {
        http_status,
        title,
        url: url.to_string(),
        content: text.chars().take(8000).collect(),
        links,
    })
    .unwrap_or_else(|_| "Error: failed to serialize result".to_string())
}

/// Crude fallback tag stripper for when Readability fails.
///
/// Linear scan over the input. The previous implementation rebuilt the
/// entire remaining string (and lowercased it) once per character —
/// O(n²) time and allocation, which could hang for seconds on a large
/// page. This version lowercases once and works with byte offsets.
/// `to_ascii_lowercase` (not `to_lowercase`) is required to keep byte
/// offsets aligned with the original: Unicode lowercasing can change
/// byte lengths (e.g. 'İ' → "i̇"), and the tag names we search for are
/// ASCII anyway.
fn strip_tags(html: &str, open: &str, close: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let mut result = String::with_capacity(html.len());
    let mut i = 0;
    while i < html.len() {
        match lower[i..].find(open) {
            Some(rel) => {
                let start = i + rel;
                result.push_str(&html[i..start]);
                if let Some(rel_close) = lower[start..].find(close) {
                    // Skip the whole <tag …>…</tag> block.
                    i = start + rel_close + close.len();
                } else {
                    // Unclosed tag: keep this character and continue
                    // scanning after it (same output as the old
                    // char-by-char version).
                    let ch_len = html[start..]
                        .chars()
                        .next()
                        .map(|c| c.len_utf8())
                        .unwrap_or(1);
                    result.push_str(&html[start..start + ch_len]);
                    i = start + ch_len;
                }
            }
            None => {
                result.push_str(&html[i..]);
                break;
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::strip_tags;

    #[test]
    fn strips_simple_block() {
        let html = "<p>a</p><script>var x = 1;</script><p>b</p>";
        assert_eq!(
            strip_tags(html, "<script", "</script>"),
            "<p>a</p><p>b</p>"
        );
    }

    #[test]
    fn strips_multiple_blocks_and_attributes() {
        let html = r#"x<script src="a.js"></script>y<script>b()</script>z"#;
        assert_eq!(strip_tags(html, "<script", "</script>"), "xyz");
    }

    #[test]
    fn is_case_insensitive() {
        let html = "a<SCRIPT>x</ScRiPt>b";
        assert_eq!(strip_tags(html, "<script", "</script>"), "ab");
    }

    #[test]
    fn keeps_unclosed_tag() {
        let html = "a<script>no close here";
        assert_eq!(strip_tags(html, "<script", "</script>"), html);
    }

    #[test]
    fn strips_pair_after_unclosed_open() {
        // The first <script never closes before the pair; the close it finds
        // belongs to the later block, so everything between is stripped —
        // same behavior as the old implementation.
        let html = "a<script>b<script>c</script>d";
        assert_eq!(strip_tags(html, "<script", "</script>"), "ad");
    }

    #[test]
    fn preserves_multibyte_content() {
        let html = "héllo<style>.a{}</style>wörld — 日本語";
        assert_eq!(
            strip_tags(html, "<style", "</style>"),
            "héllowörld — 日本語"
        );
    }

    #[test]
    fn no_match_returns_input() {
        let html = "<p>nothing to strip</p>";
        assert_eq!(strip_tags(html, "<script", "</script>"), html);
    }

    #[test]
    fn large_input_completes_quickly() {
        // ~1.6 MB with thousands of blocks: the old O(n²) version took
        // minutes on this; the linear version must finish instantly.
        let unit = "text before <script>var xxxxxxxxxxxxxxxxxxxx;</script> after\n";
        let html = unit.repeat(25_000);
        let out = strip_tags(&html, "<script", "</script>");
        assert!(!out.contains("<script"));
        assert!(out.contains("text before"));
        assert_eq!(out.matches("after").count(), 25_000);
    }
}
