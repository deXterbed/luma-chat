import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import { db } from "../lib/db";
import { getSideChatStore, deleteSideChatStore } from "./chatStore";
import { useSettingsStore } from "./settingsStore";

export const useSessionStore = create((set, get) => ({
  chatSessions: [],
  activeChatId: null,

  setSessionsFromDb: (sessions) => set({ chatSessions: sessions }),

  // Fetch messages for a session that was loaded with empty messages at startup.
  // Stores them in the session object so subsequent opens are instant.
  hydrateSession: async (sessionId) => {
    const data = await db.loadSessionMessages(sessionId);
    set((s) => ({
      chatSessions: s.chatSessions.map((sess) => {
        if (sess.id !== sessionId) return sess;
        // Merge fetched side chat messages into existing side chat stubs
        const sideChats = sess.sideChats.map((sc) => {
          const fresh = data.sideChats.find((f) => f.id === sc.id);
          return fresh ? { ...sc, messages: fresh.messages } : sc;
        });
        // Load each tab's messages into its own independent store
        sideChats.forEach((sc) => {
          getSideChatStore(sc.id)
            .getState()
            .loadMessages(sc.messages ?? [], sc.model ?? "minimax-m3:cloud");
        });
        const activeId = sess.activeSideChatId ?? sideChats[0]?.id ?? null;
        return {
          ...sess,
          messages: data.messages,
          sideChats,
          activeSideChatId: activeId,
        };
      }),
    }));
    return data;
  },
  setActiveChatId: (id) => set({ activeChatId: id }),

  // Bump a session's activity timestamp — call this when the user actually
  // does something (sends a message, adds a side chat). Just switching the
  // active chat is NOT activity and shouldn't reorder the recent list.
  bumpSessionActivity: (id) => {
    if (!id) return;
    const ts = Date.now();
    db.updateSessionActivity(id);
    set((s) => {
      const updatedSessions = s.chatSessions.map((sess) =>
        sess.id === id ? { ...sess, updated_at: ts } : sess,
      );
      return {
        chatSessions: [...updatedSessions].sort(
          (a, b) => (b.updated_at || 0) - (a.updated_at || 0),
        ),
      };
    });
  },

  addChatSession: (session) => {
    const ts = Date.now();
    const full = {
      ...session,
      sideChats: [],
      activeSideChatId: null,
      updated_at: ts,
    };
    set((s) => ({ chatSessions: [full, ...s.chatSessions] }));
    db.saveSession({
      id: session.id,
      title: session.title,
      model: session.model,
    });
  },

  updateChatSession: (id, updates) => {
    set((s) => ({
      chatSessions: s.chatSessions.map((c) =>
        c.id === id ? { ...c, ...updates } : c,
      ),
    }));
    if (updates.messages) {
      db.saveMessages(id, updates.messages);
      get().bumpSessionActivity(id);
    }
    if (updates.model || updates.title) {
      const session = get().chatSessions.find((c) => c.id === id);
      if (session)
        db.saveSession({
          id,
          title: updates.title ?? session.title,
          model: updates.model ?? session.model,
        });
    }
  },

  removeChatSession: (id) => {
    db.deleteSession(id);
    const sess = get().chatSessions.find((s) => s.id === id);
    if (sess) sess.sideChats.forEach((sc) => deleteSideChatStore(sc.id));
    set((s) => {
      const wasActive = s.activeChatId === id;
      return {
        chatSessions: s.chatSessions.filter((c) => c.id !== id),
        activeChatId: wasActive ? null : s.activeChatId,
      };
    });
  },

  addSideChat: (sessionId, model) => {
    // New side chats inherit the user's default model unless the caller
    // explicitly passes one (e.g. "add tab" copies the current tab's model).
    const finalModel =
      model ?? useSettingsStore.getState().defaultModel ?? "minimax-m3:cloud";
    const id = uuidv4();
    set((s) => ({
      chatSessions: s.chatSessions.map((sess) => {
        if (sess.id !== sessionId) return sess;
        const position = (sess.sideChats || []).length;
        db.upsertSideChat(sessionId, { id, model: finalModel }, position);
        db.setActiveSideChat(sessionId, id);
        return {
          ...sess,
          sideChats: [
            ...(sess.sideChats || []),
            { id, model: finalModel, messages: [] },
          ],
          activeSideChatId: id,
        };
      }),
    }));
    get().bumpSessionActivity(sessionId);
  },

  updateSideChat: (sessionId, sideChatId, updates) => {
    set((s) => ({
      chatSessions: s.chatSessions.map((sess) =>
        sess.id === sessionId
          ? {
              ...sess,
              sideChats: sess.sideChats.map((sc) =>
                sc.id === sideChatId ? { ...sc, ...updates } : sc,
              ),
            }
          : sess,
      ),
    }));
    if (updates.messages) {
      db.saveSideChatMessages(sideChatId, updates.messages);
      get().bumpSessionActivity(sessionId);
    }
    if (updates.model)
      db.upsertSideChat(sessionId, { id: sideChatId, model: updates.model }, 0);
  },

  setActiveSideChatId: (sessionId, sideChatId) => {
    set((s) => ({
      chatSessions: s.chatSessions.map((sess) =>
        sess.id === sessionId
          ? { ...sess, activeSideChatId: sideChatId }
          : sess,
      ),
    }));
    db.setActiveSideChat(sessionId, sideChatId);
  },

  removeSideChat: (sessionId, sideChatId) => {
    db.deleteSideChat(sideChatId);
    set((s) => ({
      chatSessions: s.chatSessions.map((sess) => {
        if (sess.id !== sessionId) return sess;
        const remaining = sess.sideChats.filter((sc) => sc.id !== sideChatId);
        if (remaining.length === 0)
          return { ...sess, sideChats: [], activeSideChatId: null };
        const wasActive = sess.activeSideChatId === sideChatId;
        return {
          ...sess,
          sideChats: remaining,
          activeSideChatId: wasActive ? remaining[0].id : sess.activeSideChatId,
        };
      }),
    }));
  },
}));
