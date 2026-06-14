// Ollama-hosted web search/fetch (https://ollama.com/api/web_search and
// /api/web_fetch). Cloud endpoints gated by an Ollama API key. The output
// shapes mirror the DuckDuckGo path in search.rs/fetch.rs so the frontend
// tool contract is identical regardless of provider.
//
// Quota/auth failures are returned with a leading "Error: QUOTA:" marker so
// the renderer can surface a prominent "upgrade or switch to DuckDuckGo"
// banner instead of a silent per-tool error.

use serde::Serialize;
use std::time::Duration;

const SEARCH_ENDPOINT: &str = "https://ollama.com/api/web_search";
const FETCH_ENDPOINT: &str = "https://ollama.com/api/web_fetch";

#[derive(Debug, Serialize)]
struct SearchResult {
    title: String,
    url: String,
    snippet: String,
}

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

pub async fn search_web_ollama(query: &str, max_results: usize, api_key: &str) -> String {
    if query.trim().is_empty() {
        return "Error: query must be a non-empty string".to_string();
    }
    if api_key.trim().is_empty() {
        return "Error: QUOTA: Ollama web search needs an API key. Add one in Settings → Web search, or switch to DuckDuckGo.".to_string();
    }

    let limit = max_results.clamp(1, 10);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap();

    let res = match client
        .post(SEARCH_ENDPOINT)
        .header("Authorization", format!("Bearer {}", api_key.trim()))
        .json(&serde_json::json!({ "query": query, "max_results": limit }))
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

    let status = res.status();
    if !status.is_success() {
        let body = res.text().await.unwrap_or_default();
        return map_api_error(status.as_u16(), &body, "search");
    }

    let data = match res.json::<serde_json::Value>().await {
        Ok(d) => d,
        Err(e) => return format!("Error: failed to parse response ({})", e),
    };

    let results: Vec<SearchResult> = data
        .get("results")
        .and_then(|r| r.as_array())
        .map(|arr| {
            arr.iter()
                .take(limit)
                .map(|r| SearchResult {
                    title: str_field(r, "title"),
                    url: str_field(r, "url"),
                    snippet: r
                        .get("content")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .chars()
                        .take(500)
                        .collect(),
                })
                .filter(|r| !r.title.is_empty() || !r.url.is_empty())
                .collect()
        })
        .unwrap_or_default();

    if results.is_empty() {
        return "No results found. Try a more specific query.".to_string();
    }

    serde_json::to_string(&results)
        .unwrap_or_else(|_| "Error: failed to serialize results".to_string())
}

pub async fn fetch_page_ollama(url: &str, api_key: &str) -> String {
    if url.trim().is_empty() {
        return "Error: url must be a non-empty string".to_string();
    }
    if api_key.trim().is_empty() {
        return "Error: QUOTA: Ollama web fetch needs an API key. Add one in Settings → Web search, or switch to DuckDuckGo.".to_string();
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap();

    let res = match client
        .post(FETCH_ENDPOINT)
        .header("Authorization", format!("Bearer {}", api_key.trim()))
        .json(&serde_json::json!({ "url": url }))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            if e.is_timeout() {
                return "Error: fetch timed out after 15s".to_string();
            }
            return format!("Error: fetch failed ({})", e);
        }
    };

    let status = res.status();
    if !status.is_success() {
        let body = res.text().await.unwrap_or_default();
        return map_api_error(status.as_u16(), &body, "fetch");
    }

    let data = match res.json::<serde_json::Value>().await {
        Ok(d) => d,
        Err(e) => return format!("Error: failed to parse response ({})", e),
    };

    let content: String = data
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .chars()
        .take(8000)
        .collect();

    if content.len() < 50 {
        return "Error: could not extract readable content from page".to_string();
    }

    // Ollama returns links as an array of URL strings; map to {text, url}.
    let links: Vec<Link> = data
        .get("links")
        .and_then(|l| l.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .take(20)
                .map(|u| Link {
                    text: u.chars().take(100).collect(),
                    url: u.to_string(),
                })
                .collect()
        })
        .unwrap_or_default();

    serde_json::to_string(&FetchResult {
        http_status: 200,
        title: str_field(&data, "title"),
        url: url.to_string(),
        content,
        links,
    })
    .unwrap_or_else(|_| "Error: failed to serialize result".to_string())
}

fn str_field(v: &serde_json::Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string()
}

/// Map a non-2xx Ollama API response to a tool-result error string. Auth and
/// quota failures get the "QUOTA:" marker the renderer keys off.
fn map_api_error(status: u16, body: &str, op: &str) -> String {
    match status {
        401 | 403 => format!(
            "Error: QUOTA: Ollama rejected the API key (HTTP {}). Check your key in Settings → Web search, or switch to DuckDuckGo.",
            status
        ),
        402 | 429 => format!(
            "Error: QUOTA: Ollama web search quota exhausted (HTTP {}). Upgrade your Ollama account or switch to DuckDuckGo in Settings.",
            status
        ),
        _ => format!(
            "Error: {} request failed (HTTP {}) {}",
            op,
            status,
            body.chars().take(200).collect::<String>()
        ),
    }
}
