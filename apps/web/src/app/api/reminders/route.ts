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
  const writes = buildPlanWrites((body ?? {}) as { title?: unknown; deadlines?: unknown; items?: unknown; opens?: unknown });
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

// PATCH /api/reminders — follow through from a talk-back chip (PROMPT.md
// 7.4). Body: { id, action: 'done' | 'snooze' }. Done closes the reminder;
// snooze pushes it out 7 days. Unknown ids fail closed with a 404.
export async function PATCH(req: Request): Promise<NextResponse> {
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
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const record = (body ?? {}) as { id?: unknown; action?: unknown };
  if (typeof record.id !== 'string' || record.id.length === 0) {
    return NextResponse.json({ error: 'id is required.' }, { status: 400 });
  }
  if (record.action !== 'done' && record.action !== 'snooze') {
    return NextResponse.json({ error: "action must be 'done' or 'snooze'." }, { status: 400 });
  }
  const db = await repo();
  try {
    if (record.action === 'done') await db.reminders.setDone(userId, record.id);
    else await db.reminders.snooze(userId, record.id);
  } catch {
    return NextResponse.json({ error: 'Could not find that reminder.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
