use scraper::{Html, Selector};
use serde::Serialize;
use std::time::Duration;

use super::html::USER_AGENT;

const DDG_HTML_ENDPOINT: &str = "https://html.duckduckgo.com/html/";

#[derive(Debug, Serialize)]
struct SearchResult {
    title: String,
    url: String,
    snippet: String,
}

pub async fn search_web(query: &str, max_results: usize) -> String {
    if query.trim().is_empty() {
        return "Error: query must be a non-empty string".to_string();
    }

    let limit = max_results.clamp(1, 10);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap();
    let params = [("q", query), ("kl", "us-en")];

    let res = match client
        .post(DDG_HTML_ENDPOINT)
        .header("User-Agent", USER_AGENT)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "text/html")
        .form(&params)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            if e.is_timeout() {
                return "Error: search timed out after 15s".to_string();
            }
            return format!("Error: search failed ({})", e);
        }
    };

    if !res.status().is_success() {
        return format!("Error: search request failed (HTTP {})", res.status());
    }

    let html = match res.text().await {
        Ok(h) => h,
        Err(e) => return format!("Error: failed to read response ({})", e),
    };

    let document = Html::parse_document(&html);
    let result_selector = Selector::parse(".result").unwrap();
    let link_selector = Selector::parse(".result__a").unwrap();
    let snippet_selector = Selector::parse(".result__snippet").unwrap();

    let mut results: Vec<SearchResult> = Vec::new();

    for el in document.select(&result_selector) {
        if results.len() >= limit {
            break;
        }

        let link = match el.select(&link_selector).next() {
            Some(l) => l,
            None => continue,
        };

        let snippet = el
            .select(&snippet_selector)
            .next()
            .map(|s| s.text().collect::<Vec<_>>().join("").trim().to_string())
            .unwrap_or_default();

        let raw_href = link.value().attr("href").unwrap_or("");
        let title = link.text().collect::<Vec<_>>().join("").trim().to_string();
        let url = extract_real_url(raw_href);

        if title.is_empty() || url.is_empty() {
            continue;
        }

        results.push(SearchResult {
            title,
            url,
            snippet,
        });
    }

    if results.is_empty() {
        return "No results found. Try a more specific query.".to_string();
    }

    serde_json::to_string(&results).unwrap_or_else(|_| "Error: failed to serialize results".to_string())
}

fn extract_real_url(href: &str) -> String {
    if href.is_empty() {
        return String::new();
    }

    let href = if href.starts_with("//") {
        format!("https:{}", href)
    } else {
        href.to_string()
    };

    if href.starts_with("http") {
        if let Ok(u) = url::Url::parse(&href) {
            // DuckDuckGo wraps URLs with uddg param.
            // url::Url::query_pairs() already percent-decodes values.
            if let Some(uddg) = u
                .query_pairs()
                .find(|(k, _)| k == "uddg")
                .map(|(_, v)| v.into_owned())
            {
                return uddg;
            }
            return u.to_string();
        }
    }

    href
}
