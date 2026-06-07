# Luma — Roadmap

A research workbench for deep-dive topic exploration using local LLMs, web-augmented for accuracy and currency.

---

## Goal

Help a user **research and gain deep knowledge in a particular topic** by coupling an LLM with live web search, structured around a main conversation with **side-chat branches** for drilling into subtopics, sources, and follow-up questions.

The side-chat model is the **fundamental interaction pattern**, not a UX extra: a research session is a tree, not a thread. The main chat is the spine, side chats are the branches, and the user navigates between them to follow their curiosity without losing the main thread.

### What the app is NOT

Not a general-purpose chatbot, not a coding agent, not a multi-tool assistant. Capabilities that don't directly serve "research a topic deeply" are out of scope, even if they're individually useful.

---

## Core interaction loop

1. User opens the app, starts a new session, asks a research question in the main chat.
2. The model responds, and as it surfaces claims, sources, or subtopics, the user opens side chats to **drill into each one independently** — without disturbing the main thread.
3. Each side chat can search the web, fetch and read sources, and synthesize findings.
4. Findings from side chats can be promoted back to the main chat's context, so the spine of the research accumulates verified knowledge.
5. Sessions persist locally (already implemented via SQLite in `electron/db.js`).

---

## Phased build plan

### Phase 0 — Foundation (✅ done)

- Electron + React + Vite scaffold
- Ollama API client with streaming (`src/lib/ollama.js`)
- Main chat + side chat with isolated stores (`src/store/chatStore.js`)
- Session persistence (SQLite via Electron main process)
- Geist font, dark/light theme, polished message bubbles

### Phase 1 — Live web research (the core capability)

**Goal:** make every chat, main and side, capable of searching the web and reading sources, with full visibility into the research process.

#### 1a. Tool-calling infrastructure

- Refactor `streamChat` in `src/lib/ollama.js` to support the tool-call loop:
  - Accept a `tools` array in the request
  - Detect `tool_calls` in the streamed response
  - Pause the stream, execute the tool, append the result as a `role: "tool"` message
  - Re-call the model with the augmented history, stream the final answer
- Cap tool rounds at 8 per response to prevent runaway loops
- Default `num_ctx` to 32K for tool-using models
- Support any tool format (Ollama, OpenAI-compatible) — define an internal `Tool` interface and adapt

#### 1b. Web search and fetch tools

- **`web_search(query, max_results)`**
  - Provider: DuckDuckGo HTML scraping (no API key, no rate limits worth mentioning)
  - Returns: `[{ title, url, snippet }]`
  - Strip ads, sponsored results, "people also ask" noise
- **`web_fetch(url)`**
  - Raw HTTP GET, extract readable content
  - Use `@mozilla/readability` + `cheerio` for clean markdown output
  - Return title, content (markdown), canonical URL
- Both tools run in the **Electron main process** (so the renderer doesn't hit CORS or expose network code) and are exposed via IPC.

#### 1c. Research-aware UI

The research process must be **visible and auditable**, not hidden. The user is using the LLM to amplify their own critical thinking, so they need to see what the model looked at.

- **Tool call indicators** in the message stream: `🔍 Searching for "..."` → `📖 Reading article...` → `✓ Used 3 sources`
- **Inline citations**: when the model uses information from a fetched page, render the URL/title as a clickable footnote-style link in the markdown output
- **Sources panel** per message (collapsible): list of all sources the model consulted for that response, with title, URL, and a 1–2 sentence excerpt
- **Search activity log** in side chats: a chronological list of every search and fetch the model performed in that branch, so the user can see the research trail

> **Status:** tool call indicators and the collapsible per-response summary are shipped in `src/components/ToolActivity.jsx`. Inline citations, the per-message sources panel, and the side-chat search log are still open (see Open Question #1 for the citation format).

#### 1d. Settings for search behavior

- Toggle: enable/disable web search per-chat (some sessions don't need it)
- Toggle: default to search (proactive) vs. search on demand (model decides)
- Provider: DuckDuckGo for v1, designed so Tavily/Brave/Ollama hosted search can be added later

### Phase 2 — Side chats as first-class research branches

**Goal:** sharpen the branching model so side chats aren't just "another chat," they're "a research subtopic with explicit context."

- **Pre-filled system prompt** when opening a side chat from a main message: "This is a deep-dive branch of the main chat about [topic]. The main chat is researching [parent question]. Your job is to investigate [specific aspect] thoroughly. Cite all sources."
- **"Promote to main chat"** button on a side chat: synthesizes the side chat's findings into a context message appended to the main chat's history, with citations preserved
- **Cross-chat research view**: all sources discovered across the main chat and all side chats in a session, deduplicated, with links to where each source was used
- **Topic context propagation**: when a side chat's main chat updates (e.g. the user continues the main chat), the side chat's system prompt updates to reflect the new state

### Phase 3 — Research artifacts (optional)

**Goal:** let the user walk away from a research session with something tangible.

- **Session export**: markdown/JSON dump of the full research tree (main + side chats), with all sources cited
- **Citation graph**: visualize which sources influenced which claims across the whole session
- **Saved research notes**: bookmarks/annotations the user can attach to any source or message
- **PDF / document reading**: same data type as a web article, different source. Drag a PDF into a side chat, model reads and cites it. Reuses the `web_fetch` tool's output formatting.

### Phase 4 — Polish

- Per-server / per-tool toggles
- Multi-round tool calls (model can fetch → read → search → fetch again)
- Error recovery (tool failed → model sees the error and adapts)
- Tool usage analytics (optional, local-only)
- Custom system prompt templates (e.g. "Socratic tutor", "Primary source skeptic")

---

## Out of scope (deliberate cuts)

These were considered and rejected because they don't serve the core research goal:

- Filesystem MCP server (user can drag files in if needed)
- Shell execution (too dangerous, not research)
- Code execution sandbox
- GitHub / Postgres / database MCP servers
- Voice I/O
- Multi-agent orchestration
- Custom personas (debatable — could fit a research tool)
- Codex-style project context (different tool category)
- HTTP/SSE MCP transports (not needed for v1)
- Image generation, multimodal outputs beyond vision input

If a future capability is proposed, the test is: **does this help a user research and deeply understand a topic?** If no, it doesn't ship.

---

## Open questions

These are decisions we deferred or haven't made yet. Each is tracked here so we don't lose them.

1. **Citation format in markdown** — bracketed `[1]`, footnote-style, or inline links? Affects how readable the output is. Try a few and pick.
2. **Model recommendations for research** — which Ollama models handle tool calling well and produce reliable citations? Need to test and document. Candidates: Qwen3, Llama 3.1+, GPT-OSS.
3. ~~**Context length per chat**~~ — resolved: side chats inject the last 10 main-chat messages, hard-capped at 4000 chars. Keeps small local models from overflowing while still providing recent context.
4. **DDG scraping reliability** — DDG can change their HTML and break scrapers. Fallback strategy? (Tavily free tier? SearXNG self-hosted?)
5. ~~**Search result quality vs. speed**~~ — resolved: `searchWeb` defaults to `maxResults = 5` per call, hard-capped at 10 (`electron/tools/search.js`). The model can call `web_search` again if it needs more; no fixed "how many to read in full" rule — the model decides.

---

## Architecture decisions made

These are the "we decided this, don't relitigate" notes.

- **Tool calling > client-side injection.** The user (and model) need to see the research process; the model needs to choose what to search and what to read in full. Client-side auto-injection hides both.
- **DuckDuckGo > Ollama hosted web search.** Self-hosted ethos, no API key, no rate limits, no vendor dependency. (Reconsidered: this is a research tool, not a general assistant — staying self-contained matters.)
- **In-process MCP servers > stdio MCP servers, for now.** No node_modules bloat, no extra runtime, faster startup. The MCP client class will be designed so stdio servers can be added later as an opt-in "power user" feature. *(Not currently scheduled — see Out of scope; this decision is recorded in case we change our minds.)*
- **Web tools in main process, not renderer.** Avoids CORS, keeps network code in one auditable place, lets us use Node-only libraries (cheerio, readability).
- **Side chats stay isolated, with optional context bridge.** Implemented in `src/hooks/useStreamingChat.js`: when a side chat starts a stream, it pulls `getApiMessages()` from the supplied `contextStore` (a Zustand hook prop passed by `ChatPane`, typically `useMainChat`), takes the last 10 messages, and injects them as a system-prompt transcript truncated to 4000 chars. We'll extend the same channel for promoted findings and topic-context propagation.
- **Persistence is local-first.** SQLite via Electron main process, no cloud sync. Sessions are the user's private research, not a collaborative product.

---

## Status

| Phase | Status | Notes |
|---|---|---|
| Phase 0 — Foundation | ✅ Done | Electron + React + Ollama client + side chats + persistence |
| Phase 1a — Tool calling | ✅ Done | `streamChat` tool-call loop in `src/lib/ollama.js`, default `maxToolRounds = 5`, `get_current_time` tool |
| Phase 1b — Web tools | ✅ Done | DDG search (default 5 results, max 10) + HTTP fetch + Readability extraction via Electron main process |
| Phase 1c — Research UI | 🟡 Partial | `ToolActivity` component — live tool indicators and collapsible per-response summary shipped. Inline citations, sources panel, and side-chat search log still pending. |
| Phase 1d — Search settings | ✅ Done | Per-pane web search toggle in `uiStore`, filters tools before passing to `streamChat` |
| Phase 2 — Side chat branches | ⏸ Waiting | Branch context, promote-to-main, cross-chat sources |
| Phase 3 — Artifacts | ⏸ Future | Export, citation graph, saved notes |
| Phase 4 — Polish | ⏸ Future | Multi-round tools, error recovery, prompt templates |
