// Group panel chats by recency: Today, the previous 7 days, older.
// Pure date math over stored updatedAt strings; unit-tested in
// chat-groups.test.ts. Runs under plain node:test (no DOM).

import type { ChatSummary } from './stores.ts';

export interface ChatGroups {
  today: ChatSummary[];
  previous7d: ChatSummary[];
  older: ChatSummary[];
}

const DAY_MS = 86_400_000;

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Bucket chats newest-first into Today / Previous 7 days / Older. */
export function groupChatsByRecency(chats: ChatSummary[], now = new Date()): ChatGroups {
  const today: ChatSummary[] = [];
  const previous7d: ChatSummary[] = [];
  const older: ChatSummary[] = [];
  const todayStart = startOfDay(now.getTime());
  for (const c of chats) {
    const t = new Date(c.updatedAt).getTime();
    if (Number.isNaN(t)) {
      older.push(c);
      continue;
    }
    const ageDays = Math.round((todayStart - startOfDay(t)) / DAY_MS);
    if (ageDays <= 0) today.push(c);
    else if (ageDays <= 7) previous7d.push(c);
    else older.push(c);
  }
  return { today, previous7d, older };
}
