import { useEffect } from "react";
import { db } from "../lib/db";
import { useSessionStore } from "../store/sessionStore";
import { useMainChat } from "../store/chatStore";

export function useDbInit() {
  const { setSessionsFromDb, hydrateSession, setActiveChatId } =
    useSessionStore();
  const loadMessages = useMainChat((s) => s.loadMessages);

  useEffect(() => {
    db.loadSessions()
      .then(async (sessions) => {
        if (!sessions || sessions.length === 0) return;
        setSessionsFromDb(sessions);
        const last = sessions[0];
        setActiveChatId(last.id);
        const data = await hydrateSession(last.id);
        loadMessages(data.messages, last.model);
      })
      .catch(() => {});
  }, []);
}
