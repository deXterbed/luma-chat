use scraper::{Html, Selector};
use serde::Serialize;
use std::time::Duration;

use super::html::{html_to_readable_text, USER_AGENT};

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

    let res = match client
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

    let html_text = match res.text().await {
        Ok(h) => h,
        Err(e) => return format!("Error: failed to read response ({})", e),
    };

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
fn strip_tags(html: &str, open: &str, close: &str) -> String {
    let mut result = String::with_capacity(html.len());
    let chars: Vec<char> = html.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let remaining: String = chars[i..].iter().collect();
        let remaining_lower = remaining.to_lowercase();
        if remaining_lower.starts_with(open) {
            // Find matching close
            if let Some(end) = remaining_lower.find(close) {
                i += end + close.len();
                continue;
            }
        }
        result.push(chars[i]);
        i += 1;
    }
    result
}
