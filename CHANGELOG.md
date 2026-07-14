# Changelog

## [1.1.0] - 2026-07-15

### Added
- Resizable sidebar with hover-to-expand titles
- Full URL tooltip on chat link hover
- Stop button now actually cancels `ollama_chat_stream` mid-stream instead of draining the response after Stop is pressed

### Fixed
- Currency dollar signs (e.g. `$40`, `$0.40`) no longer misparsed as math delimiters, which previously garbled pricing text in tables
- Math rendering switched to Temml (from KaTeX/MathJax) for smaller bundle size
- Side panels lazy-loaded to reduce initial bundle size
- Dynamic imports for `@tauri-apps/api/core` standardized, eliminating Vite optimization warnings
- Input box auto-focuses when switching or deleting chats, and when a new side chat is created
- `save_messages` made atomic and skips rewriting unchanged rows via upsert
- Web fetch body capped at 2 MB with a linear tag-stripping fallback
- `useChatSession` uses narrow selectors to avoid re-rendering every `ChatPane`
- Database path now resolved via Tauri's `app_data_dir()`, with automatic migration from the legacy `luma.db` location

## [1.0.0] - Initial release
