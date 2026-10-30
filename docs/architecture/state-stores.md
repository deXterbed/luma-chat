# State stores

The four rules that must hold before you change a store are in `AGENTS.md`. This is the rest of the
shape.

Stores are independent, none persisted to `localStorage` (SQLite is the persistence layer), and
everything reads through selectors so a subscription only re-renders for the slice it reads.

`chatStore.js` exports `createChatStore(id)`; both panes use the same factory, and a side chat owns
its store for life in a `Map` keyed by tab id, never recreated on tab switch. New chats start with an
empty `model` — each store subscribes to `useSettingsStore` and lazily applies `defaultModel` once
hydrated, so module init doesn't depend on the DB being open.

Who owns what, read from the store files: the chat stores hold messages, streaming state, tool-call
records, model, `chatNonce`, `projectRoots` and `webSearchEnabled`; `sessionStore` holds the session
list and the `activeChatId` navigation pointer; `uiStore` holds transient view state (side-panel
open, connectivity, settings page); `settingsStore` holds persisted settings and the `hydrated` flag.
