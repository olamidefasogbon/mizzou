import { NextResponse } from 'next/server';
import { AuthRequiredError, resolveUser } from '@/lib/auth';
import { repo } from '@/lib/repo';
import { buildPlanWrites } from '@/lib/plan-sync';

// POST /api/reminders — approve a plan into dated reminders plus one
// idempotent calendar-ledger row per deadline. Body: { title, deadlines?,
// items?, opens?, label? }. Repeat posts are safe: an open reminder with the
// same title and date line is updated instead of duplicated, and the ledger
// upserts on (user_id, event_id). A { restore } body recreates one removed
// reminder (Undo) without touching the ledger.

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

interface RestoreBody {
  title?: unknown;
  sub?: unknown;
  pill?: unknown;
  dueAt?: unknown;
  kind?: unknown;
}

function validRestore(record: Record<string, unknown>): RestoreBody | null {
  const restore = record['restore'];
  if (!restore || typeof restore !== 'object') return null;
  const r = restore as RestoreBody;
  if (typeof r.title !== 'string' || r.title.trim().length === 0) return null;
  if (typeof r.sub !== 'string' || typeof r.pill !== 'string') return null;
  if (r.dueAt !== null && r.dueAt !== undefined && typeof r.dueAt !== 'string') return null;
  return r;
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
  const record = (body ?? {}) as Record<string, unknown>;
  const db = await repo();
  const restore = validRestore(record);
  if (restore) {
    const created = await db.reminders.create(userId, {
      title: (restore.title as string).slice(0, 200),
      sub: (restore.sub as string).slice(0, 400),
      pill: (restore.pill as string).slice(0, 60),
      dueAt: typeof restore.dueAt === 'string' ? restore.dueAt : null,
      kind: typeof restore.kind === 'string' ? (restore.kind as string).slice(0, 32) : 'custom',
    });
    return NextResponse.json({ restored: created.id });
  }
  const writes = buildPlanWrites(
    record as { title?: unknown; deadlines?: unknown; items?: unknown; opens?: unknown; label?: unknown },
  );
  if ('error' in writes) return badRequest(writes.error);
  const open = await db.reminders.list(userId);
  const byKey = new Map(open.map((r) => [`${r.title}|${r.sub}|${r.dueAt ?? ''}`, r]));
  let created = 0;
  let updated = 0;
  for (const w of writes.reminders) {
    const key = `${w.title}|${w.sub}|${w.dueAt ?? ''}`;
    const existing = byKey.get(key);
    if (existing) {
      if ((existing.dueAt ?? null) !== (w.dueAt ?? null) || existing.pill !== w.pill) {
        await db.reminders.update(userId, existing.id, { dueAt: w.dueAt, pill: w.pill, sub: w.sub });
        updated += 1;
      }
      continue;
    }
    byKey.set(key, { id: '', userId, title: w.title, sub: w.sub, pill: w.pill, dueAt: w.dueAt, kind: w.kind, done: false });
    await db.reminders.create(userId, { title: w.title, sub: w.sub, pill: w.pill, dueAt: w.dueAt, kind: w.kind });
    created += 1;
  }
  await db.syncLedger.upsert(userId, writes.ledger);
  return NextResponse.json({ created, updated, synced: writes.ledger.length });
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

// DELETE /api/reminders — remove one reminder ({ id }) or clear every
// reminder ({ all: true }). Single removes return the deleted row so the
// client can offer Undo; clear returns the count. Unknown ids 404.
export async function DELETE(req: Request): Promise<NextResponse> {
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
  const record = (body ?? {}) as { id?: unknown; all?: unknown };
  const db = await repo();
  if (record.all === true) {
    const cleared = await db.reminders.clear(userId);
    return NextResponse.json({ cleared });
  }
  if (typeof record.id !== 'string' || record.id.length === 0) {
    return NextResponse.json({ error: 'id is required.' }, { status: 400 });
  }
  try {
    const removed = await db.reminders.remove(userId, record.id);
    return NextResponse.json({ removed });
  } catch {
    return NextResponse.json({ error: 'Could not find that reminder.' }, { status: 404 });
  }
}
