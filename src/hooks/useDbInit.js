import { useEffect } from 'react'
import { db } from '../lib/db'
import { useAppStore } from '../store/appStore'

export function useDbInit() {
  const setSessionsFromDb = useAppStore(s => s.setSessionsFromDb)

  useEffect(() => {
    db.loadSessions().then(sessions => {
      if (sessions && sessions.length > 0) setSessionsFromDb(sessions)
    }).catch(() => {})
  }, [])
}
