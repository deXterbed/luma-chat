mod fetch;
mod html;
mod search;

pub use fetch::fetch_page;
pub use search::search_web;

#[cfg(test)]
mod tests {
    use super::html::{collapse_newlines, html_to_readable_text};
    use scraper::Html;

    #[test]
    fn test_collapse_newlines() {
        assert_eq!(collapse_newlines("hello\n\nworld"), "hello\n\nworld");
        assert_eq!(collapse_newlines("hello\n\n\nworld"), "hello\n\nworld");
        assert_eq!(collapse_newlines("hello\n\n\n\nworld"), "hello\n\nworld");
        assert_eq!(collapse_newlines("\n\nhello\n\n"), "hello");
        assert_eq!(collapse_newlines("no newlines"), "no newlines");
        assert_eq!(collapse_newlines(""), "");
    }

    #[test]
    fn test_html_to_readable_text_headings() {
        let _html = Html::parse_fragment("<h1>Title</h1><h2>Subtitle</h2><h3>Sub-sub</h3>");
        // Note: scraper uses a specific HTML parser, fragments might need body tags for some selectors.
        // The current implementation in html.rs expects a body tag.
        let html_with_body =
            Html::parse_document("<body><h1>Title</h1><h2>Subtitle</h2><h3>Sub-sub</h3></body>");
        let result = html_to_readable_text(&html_with_body);
        assert!(result.contains("# Title"));
        assert!(result.contains("## Subtitle"));
        assert!(result.contains("### Sub-sub"));
    }

    #[test]
    fn test_html_to_readable_text_paragraphs() {
        let html = Html::parse_document("<body><p>Paragraph 1</p><p>Paragraph 2</p></body>");
        let result = html_to_readable_text(&html);
        assert!(result.contains("Paragraph 1"));
        assert!(result.contains("Paragraph 2"));
    }

    #[test]
    fn test_html_to_readable_text_list_items() {
        let html = Html::parse_document("<body><ul><li>Item 1</li><li>Item 2</li></ul></body>");
        let result = html_to_readable_text(&html);
        assert!(result.contains("- Item 1"));
        assert!(result.contains("- Item 2"));
    }

    #[test]
    fn test_html_to_readable_text_code_blocks() {
        let html = Html::parse_document("<body><pre>code block</pre></body>");
        let result = html_to_readable_text(&html);
        assert!(result.contains("```"));
        assert!(result.contains("code block"));
    }

    #[test]
    fn test_html_to_readable_text_inline_code() {
        let html = Html::parse_document("<body><p>Use <code>function()</code> here</p></body>");
        let result = html_to_readable_text(&html);
        assert!(result.contains("`function()`"));
    }

    #[test]
    fn test_html_to_readable_text_empty() {
        let html = Html::parse_document("<body></body>");
        let result = html_to_readable_text(&html);
        assert_eq!(result, "");
    }

    #[test]
    fn test_html_to_readable_text_ignores_unknown_tags() {
        let html = Html::parse_document("<body><div>content</div><span>more</span></body>");
        let result = html_to_readable_text(&html);
        // div and span are not handled in the match tag block, so they should be empty
        assert_eq!(result, "");
    }

    #[test]
    fn test_html_to_readable_text_nested() {
        let html = Html::parse_document(
            "<body><h1>Title</h1><p>Paragraph with <code>code</code> inside</p></body>",
        );
        let result = html_to_readable_text(&html);
        assert!(result.contains("# Title"));
        assert!(result.contains("`code`"));
    }
}
