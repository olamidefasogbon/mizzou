import { NextResponse } from 'next/server';
import { AuthRequiredError, resolveUser } from '@/lib/auth';
import { repo } from '@/lib/repo';

// POST /api/reminders — approve a plan into dated reminders (P1-10).
// Body: { title: string, deadlines?: string[], items?: string[] }.
// One reminder per deadline (kind deadline) and one per item (custom).

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Dated';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export async function POST(req: Request): Promise<NextResponse> {
  let userId: string;
  try {
    ({ userId } = await resolveUser());
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'Sign in with Google to continue.' }, { status: 401 });
    }
    throw err;
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body.');
  }
  const input = (body ?? {}) as { title?: unknown; deadlines?: unknown; items?: unknown };
  if (typeof input.title !== 'string' || input.title.trim().length === 0) {
    return badRequest('title is required.');
  }
  const title = input.title.trim();
  const deadlines = Array.isArray(input.deadlines)
    ? input.deadlines.filter((d): d is string => typeof d === 'string')
    : [];
  const items = Array.isArray(input.items) ? input.items.filter((i): i is string => typeof i === 'string') : [];
  if (deadlines.length === 0 && items.length === 0) {
    return badRequest('Nothing to sync.');
  }
  const db = await repo();
  let created = 0;
  for (const iso of deadlines.slice(0, 10)) {
    await db.reminders.create(userId, {
      title,
      sub: 'Application deadline',
      pill: shortDate(iso),
      dueAt: iso,
      kind: 'deadline',
    });
    created += 1;
  }
  for (const task of items.slice(0, 50)) {
    await db.reminders.create(userId, { title, sub: task, pill: 'Task', kind: 'custom' });
    created += 1;
  }
  return NextResponse.json({ created });
}
