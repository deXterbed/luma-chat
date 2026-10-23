// Recency buckets for the sidebar chat list. Sessions carry `updated_at` as
// epoch milliseconds (SQLite `unixepoch() * 1000`).
//
// "Recent" deliberately spans today AND yesterday regardless of the calendar
// week, so a Monday still shows Sunday's chats up top. Weeks are Monday-based.

const DAY_MS = 24 * 60 * 60 * 1000;

export const GROUPS = [
  { key: "recent", label: "Recent" },
  { key: "thisWeek", label: "This week" },
  { key: "lastWeek", label: "Last week" },
  { key: "older", label: "Older" },
];

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(date) {
  const d = startOfDay(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/**
 * Bucket sessions into ordered, non-empty recency groups.
 * A missing/zero `updated_at` counts as older.
 */
export function groupSessionsByRecency(sessions, now = new Date()) {
  const yesterday = startOfDay(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekStart = startOfWeek(now);
  const lastWeekStart = new Date(weekStart.getTime() - 7 * DAY_MS);

  const byKey = { recent: [], thisWeek: [], lastWeek: [], older: [] };

  for (const session of sessions) {
    const ts = session.updated_at || 0;
    if (ts >= yesterday.getTime()) byKey.recent.push(session);
    else if (ts >= weekStart.getTime()) byKey.thisWeek.push(session);
    else if (ts >= lastWeekStart.getTime()) byKey.lastWeek.push(session);
    else byKey.older.push(session);
  }

  return GROUPS.map((group) => ({ ...group, sessions: byKey[group.key] })).filter(
    (group) => group.sessions.length > 0,
  );
}
