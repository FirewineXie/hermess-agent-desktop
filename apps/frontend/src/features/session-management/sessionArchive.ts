// The locked list endpoint backfills pinned sessions even with archived=only.
// Search also spans both stores, so the archive page must check each row's state.
export function archivedSessions<T extends { archived?: boolean }>(sessions: T[]): T[] {
  return sessions.filter(session => session.archived === true)
}
