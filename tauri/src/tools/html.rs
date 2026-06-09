pub const USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/// Convert an HTML body (scraper fragment) into readable Markdown-style text.
pub fn html_to_readable_text(document: &scraper::Html) -> String {
    let body = document
        .select(&scraper::Selector::parse("body").unwrap())
        .next();

    let mut out = String::new();

    if let Some(body) = body {
        for el in body.select(&scraper::Selector::parse("*").unwrap()) {
            let tag = el.value().name();
            let text = el.text().collect::<Vec<_>>().join("").trim().to_string();

            if text.is_empty() {
                continue;
            }

            match tag {
                t if t.starts_with('h') && t.len() == 2 => {
                    if let Some(level) = t.chars().nth(1).and_then(|c| c.to_digit(10)) {
                        out.push_str("\n\n");
                        out.push_str(&"#".repeat(level as usize));
                        out.push(' ');
                        out.push_str(&text);
                        out.push('\n');
                    }
                }
                "p" => {
                    out.push_str(&text);
                    out.push('\n');
                }
                "li" => {
                    out.push_str("- ");
                    out.push_str(&text);
                    out.push('\n');
                }
                "pre" => {
                    out.push_str("\n```\n");
                    out.push_str(&text);
                    out.push_str("\n```\n");
                }
                "code" => {
                    out.push('`');
                    out.push_str(&text);
                    out.push('`');
                }
                _ => {}
            }
        }
    }

    collapse_newlines(&out)
}

// Simple regex replacement without adding a dependency
pub fn collapse_newlines(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut newline_count = 0;
    for ch in s.chars() {
        if ch == '\n' {
            newline_count += 1;
            if newline_count <= 2 {
                result.push(ch);
            }
        } else {
            newline_count = 0;
            result.push(ch);
        }
    }
    result.trim().to_string()
}
