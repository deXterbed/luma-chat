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
5. Sessions persist locally (SQLite via the Tauri Rust backend, `tauri/src/db.rs`).

---

## Phased build plan

### Phase 1 — Live web research (remaining)

#### 1c. Research-aware UI

The research process must be **visible and auditable**, not hidden. The user is using the LLM to amplify their own critical thinking, so they need to see what the model looked at.

Still open:
- **Search activity log** in side chats: a chronological list of every search and fetch the model performed in that branch, so the user can see the research trail.

> Shipped: tool call indicators and the collapsible per-response summary in `src/components/ToolActivity.jsx`. Inline citations and the per-message sources panel have been dropped as out of scope.

### Phase 2 — Side chats as first-class research branches

**Goal:** sharpen the branching model so side chats aren't just "another chat," they're "a research subtopic with explicit context."

- **Topic context propagation**: when a side chat's main chat updates (e.g. the user continues the main chat), the side chat's system prompt updates to reflect the new state.

> Shipped: pre-filled prompts when opening a side chat from a main message. "Promote to main chat" and the cross-chat sources view have been dropped as out of scope.

### Phase 3 — Research artifacts (optional)

**Goal:** let the user walk away from a research session with something tangible.

- **Session export**: markdown/JSON dump of the full research tree (main + side chats), with all sources cited
- **Citation graph**: visualize which sources influenced which claims across the whole session
- **Saved research notes**: bookmarks/annotations the user can attach to any source or message
- **PDF / document reading**: same data type as a web article, different source. Drag a PDF into a side chat, model reads and cites it. Reuses the `web_fetch` tool's output formatting.

### Phase 4 — Polish

- Per-server / per-tool toggles
- Error recovery (tool failed → model sees the error and adapts)
- Tool usage analytics (optional, local-only)
- Custom system prompt templates (e.g. "Socratic tutor", "Primary source skeptic")

#### 4a. Settings page

A dedicated settings page, opened from a gear icon in the title bar. Persistence goes to a new `settings` SQLite table (key/value) exposed via Tauri commands — no `localStorage` (see Architecture decisions).

Scope tiers, smallest to largest:

- **(A) Minimal — ✅ Done** — theme, default model for new chats, default web-search toggle.
- **(B) Research-focused** — generation parameters exposed to the user: `temperature` (currently hardcoded to `0.7` in `src/lib/ollamaStream.js`), `num_ctx` (currently `8192`), `maxToolRounds` (currently `10`, with a `HARD_CAP = 15` safety ceiling), and the side-chat context bridge constants in `useStreamingChat.js` (last 10 main-chat messages, truncated to 4000 chars). Includes a small note explaining the hard caps so users don't try to disable them.
- **(C) Full** — (B) plus data management (clear all sessions with confirmation, export the full research tree as Markdown/JSON, view DB path) and an About section (app version, Ollama connection status, links to README/ROADMAP).

---

## Out of scope (deliberate cuts)

These were considered and rejected because they don't serve the core research goal:

- Filesystem MCP server (user can drag files in if needed)
- Shell execution (too dangerous, not research)
- Code execution sandbox
- GitHub / Postgres / database MCP servers
- Voice I/O
- Multi-agent orchestration (revisit only if **model routing** — a cheap-fast model for search triage plus a strong model for synthesis — proves necessary; full planner/searcher/accumulator agents clash with the local-LLM VRAM constraint that drove the `num_ctx: 8192` decision and with the "research process must be visible and auditable" principle in Phase 1c. The single-model `streamChat` loop already fills the planner + accumulator roles; parallelize tool execution and add a search budget before considering separate agents.)
- Custom personas (debatable — could fit a research tool)
- Codex-style project context (different tool category)
- HTTP/SSE MCP transports (not needed for v1)
- Image generation, multimodal outputs beyond vision input
- Inline citations and per-message sources panel (dropped: added noise without enough value to justify the rendering complexity)
- "Promote to main chat" and cross-chat sources view (dropped: side-chat isolation is the point; merging findings back undermines the branch model)

If a future capability is proposed, the test is: **does this help a user research and deeply understand a topic?** If no, it doesn't ship.

---

## Open questions

These are decisions we deferred or haven't made yet. Each is tracked here so we don't lose them.

1. **Model recommendations for research** — which Ollama models handle tool calling well and produce reliable citations? Need to test and document. Candidates: Qwen3, Llama 3.1+, GPT-OSS.
2. **DDG scraping reliability** — DDG can change their HTML and break scrapers. Fallback strategy? (Tavily free tier? SearXNG self-hosted?)

---

## Architecture decisions made

These are the "we decided this, don't relitigate" notes.

- **Tool calling > client-side injection.** The user (and model) need to see the research process; the model needs to choose what to search and what to read in full. Client-side auto-injection hides both.
- **DuckDuckGo > Ollama hosted web search.** Self-hosted ethos, no API key, no rate limits, no vendor dependency. (Reconsidered: this is a research tool, not a general assistant — staying self-contained matters.)
- **In-process MCP servers > stdio MCP servers, for now.** No node_modules bloat, no extra runtime, faster startup. The MCP client class will be designed so stdio servers can be added later as an opt-in "power user" feature. *(Not currently scheduled — see Out of scope; this decision is recorded in case we change our minds.)*
- **Web tools in the Tauri Rust backend, not renderer.** Avoids CORS, keeps network code in one auditable place, lets us use Rust crates (`scraper`, `readability`).
- **Side chats stay isolated, with optional context bridge.** Implemented in `src/hooks/useStreamingChat.js`: when a side chat starts a stream, it pulls `getApiMessages()` from the supplied `contextStore` (a Zustand hook prop passed by `ChatPane`, typically `useMainChat`), takes the last 10 messages, and injects them as a system-prompt transcript truncated to 4000 chars.
- **`num_ctx` defaults to 8192, not 32K.** Larger context is a real VRAM cost on local LLMs, and many locally-run models can't use 32K at all. 8192 is large enough for tool rounds with fetched content while staying usable on modest hardware. Cloud models can raise it per-chat once `num_ctx` is exposed as a setting (Phase 4a-B).
- **Persistence is local-first.** SQLite via the Tauri Rust backend (`tauri/src/db.rs`), no cloud sync. Sessions are the user's private research, not a collaborative product.

---

## Status

| Phase | Status | Notes |
|---|---|---|
| Phase 1c — Research UI | 🟡 Partial | Tool indicators + collapsible summary shipped. Side-chat search log pending. Inline citations + sources panel dropped. |
| Phase 2 — Side chat branches | ⏸ Waiting | Topic-context propagation pending. Pre-fill on open shipped; promote-to-main + cross-chat sources dropped. |
| Phase 3 — Artifacts | ⏸ Future | Export, citation graph, saved notes, PDF reading |
| Phase 4 — Polish | ⏸ Future | Toggles, error recovery, analytics, prompt templates. **4a(A) ✅ Done; 4a(B) research-focused settings next.** |