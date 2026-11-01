// A plan only offers what can still happen: deadlines that have passed are
// told to the person in words, never put on a calendar. Pure and client-safe.

/** Keep ISO instants that are still ahead of `now`; drop passed and unreadable ones. */
export function upcomingDeadlines(isos: string[], now: Date = new Date()): string[] {
  return isos.filter((iso) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= now.getTime();
  });
}
