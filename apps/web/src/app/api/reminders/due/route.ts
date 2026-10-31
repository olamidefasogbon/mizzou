import { NextResponse } from 'next/server';
import { AuthRequiredError, resolveUser } from '@/lib/auth';
import { repo } from '@/lib/repo';

// GET /api/reminders/due — reminders that need follow-through (PROMPT.md
// 7.4): open, dated, due within the next 7 days or overdue, soonest first.
// The chat opens with the top one plus Done / Snooze / Help me chips.
const DUE_WINDOW_MS = 7 * 86400000;

export async function GET(): Promise<NextResponse> {
  let userId: string;
  try {
    ({ userId } = await resolveUser());
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'Give it a minute and try again.' }, { status: 503 });
    }
    throw err;
  }
  const db = await repo();
  const open = await db.reminders.list(userId);
  const now = Date.now();
  const due = open
    .filter((r) => r.dueAt !== null && Date.parse(r.dueAt) <= now + DUE_WINDOW_MS)
    .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''))
    .slice(0, 10)
    .map((r) => ({ id: r.id, title: r.title, sub: r.sub, pill: r.pill, dueAt: r.dueAt }));
  return NextResponse.json({ due });
}
