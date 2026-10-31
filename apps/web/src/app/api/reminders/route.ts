import { NextResponse } from 'next/server';
import { AuthRequiredError, resolveUser } from '@/lib/auth';
import { repo } from '@/lib/repo';
import { buildPlanWrites } from '@/lib/plan-sync';

// POST /api/reminders — approve a plan into dated reminders plus one
// idempotent calendar-ledger row per deadline. Body: { title, deadlines?,
// items? }. Repeat posts are safe: existing open reminders are skipped and
// the ledger upserts on (user_id, event_id).

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(req: Request): Promise<NextResponse> {
  let userId: string;
  try {
    ({ userId } = await resolveUser());
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'Give it a minute and try again.' }, { status: 503 });
    }
    throw err;
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body.');
  }
  const writes = buildPlanWrites((body ?? {}) as { title?: unknown; deadlines?: unknown; items?: unknown });
  if ('error' in writes) return badRequest(writes.error);
  const db = await repo();
  const open = await db.reminders.list(userId);
  const seen = new Set(open.map((r) => `${r.title}|${r.dueAt ?? r.sub}`));
  let created = 0;
  for (const w of writes.reminders) {
    const key = `${w.title}|${w.dueAt ?? w.sub}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await db.reminders.create(userId, { title: w.title, sub: w.sub, pill: w.pill, dueAt: w.dueAt, kind: w.kind });
    created += 1;
  }
  await db.syncLedger.upsert(userId, writes.ledger);
  return NextResponse.json({ created, synced: writes.ledger.length });
}
