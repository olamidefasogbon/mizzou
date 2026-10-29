// Coming up visibility (docs/design/UI_CORRECTIONS.md section 3).
// Pure, framework-free: the dismissal version lives in a cookie the server
// reads before first paint, so server HTML and the first client render
// always agree. A stored dismissal hides the card; any new or newly-due
// reminder changes the version and shows it again.

export interface ReminderLike {
  id: string;
  pill: string;
  done: boolean;
  dueAt: string | null;
}

export const DISMISS_COOKIE = 'mz-comingup-dismissed';

export function remindersVersion(reminders: ReminderLike[]): string {
  return reminders.map((r) => `${r.id}:${r.pill}:${r.done}:${r.dueAt ?? ''}`).join('|');
}

/** Null when nothing was dismissed (or nothing can be read, e.g. SSR without a header). */
export function readDismissed(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== DISMISS_COOKIE) continue;
    try {
      const value = decodeURIComponent(part.slice(eq + 1).trim());
      return value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function shouldShowComingUp(reminders: ReminderLike[], dismissed: string | null): boolean {
  return reminders.length > 0 && dismissed !== remindersVersion(reminders);
}
