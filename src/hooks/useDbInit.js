import { useEffect } from 'react'
import { db } from '../lib/db'
import { useSessionStore } from '../store/sessionStore'

export function useDbInit() {
  const setSessionsFromDb = useSessionStore(s => s.setSessionsFromDb)

  useEffect(() => {
    db.loadSessions().then(sessions => {
      if (sessions && sessions.length > 0) setSessionsFromDb(sessions)
    }).catch(() => {})
  }, [])
}
