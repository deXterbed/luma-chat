import { useEffect } from "react";
import { db } from "../lib/db";
import { useSessionStore } from "../store/sessionStore";
import { useMainChat } from "../store/chatStore";
import { useSettingsStore } from "../store/settingsStore";

export function useDbInit() {
  const { setSessionsFromDb, hydrateSession, setActiveChatId } =
    useSessionStore();
  const loadMessages = useMainChat((s) => s.loadMessages);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Hydrate settings first. The index.html inline script already painted
      // a sensible theme on <html> before React mounted, so this is mostly
      // for the React-side state (`defaultModel`, `webSearchDefault`) and
      // for re-applying the authoritative SQLite theme if the legacy
      // localStorage hint was wrong.
      try {
        await hydrateSettings();
      } catch {
        // Settings load failed; in-memory defaults are still safe to use.
      }
      if (cancelled) return;

      try {
        const sessions = await db.loadSessions();
        if (cancelled) return;
        if (!sessions || sessions.length === 0) return;
        setSessionsFromDb(sessions);
        const last = sessions[0];
        setActiveChatId(last.id);
        const data = await hydrateSession(last.id);
        if (cancelled) return;
        loadMessages(data.messages, last.model);
      } catch {
        // Session restore failed; the user can still start a new chat.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}
