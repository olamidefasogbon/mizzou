// Pure panel helpers (P2-13/14). Kept free of React so they run under plain
// node --test. The panel component imports these; behavior stays identical.
import type { ChatSummary, Reminder } from '@/lib/stores';

/** 5s Undo window for Clear all chats. */
export const UNDO_WINDOW_MS = 5000;

/** sessionStorage key holding the cleared-chat snapshot so Undo survives refresh. */
export const CLEARED_SNAPSHOT_KEY = 'mz:cleared-chats';

/** Chats whose route is open: /app/c/<id>. Null elsewhere (home, other routes). */
export function activeChatIdFromPath(pathname: string | null | undefined): string | null {
  if (!pathname || !pathname.startsWith('/app/c/')) return null;
  const id = decodeURIComponent(pathname.slice('/app/c/'.length).split('/')[0] ?? '');
  return id === '' ? null : id;
}

/** Case-insensitive title match; blank query returns the full list. */
export function filterPanelChats(chats: ChatSummary[], query: string): ChatSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return chats;
  return chats.filter((c) => c.title.toLowerCase().includes(q));
}

/** Case-insensitive title + subtitle match; blank query returns the full list. */
export function filterPanelReminders(reminders: Reminder[], query: string): Reminder[] {
  const q = query.trim().toLowerCase();
  if (!q) return reminders;
  return reminders.filter((r) => `${r.title} ${r.sub}`.toLowerCase().includes(q));
}

/** Pill count: exactly the number of OPEN reminders. */
export function openReminderCount(reminders: Reminder[]): number {
  return reminders.filter((r) => !r.done).length;
}

export interface ClearedSnapshot {
  at: number;
  rows: ChatSummary[];
}

export function serializeSnapshot(rows: ChatSummary[], now: number): string {
  const snap: ClearedSnapshot = { at: now, rows };
  return JSON.stringify(snap);
}

/**
 * Parse a stored snapshot. Returns the rows only when the snapshot is intact
 * and still inside the Undo window; null when missing, corrupt, or expired.
 */
export function readSnapshot(raw: string | null | undefined, now: number): ChatSummary[] | null {
  if (!raw) return null;
  try {
    const snap = JSON.parse(raw) as Partial<ClearedSnapshot>;
    if (typeof snap.at !== 'number' || !Array.isArray(snap.rows)) return null;
    if (now - snap.at > UNDO_WINDOW_MS) return null;
    return snap.rows as ChatSummary[];
  } catch {
    return null;
  }
}
