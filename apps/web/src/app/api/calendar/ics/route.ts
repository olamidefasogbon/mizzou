import { createHash } from 'node:crypto';
import { createEvents, type EventAttributes } from 'ics';

const MAX_DEADLINES = 10;
const MAX_ITEMS = 50;
const DAY_MS = 86_400_000;

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

function toArray(date: Date): [number, number, number, number, number] {
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), 9, 0];
}

function uidFor(title: string, iso: string, kind: string): string {
  return createHash('sha256').update(`${title}|${iso}|${kind}`).digest('hex');
}

function checklist(items: string[], portalUrl: string | null): string {
  const lines = items.map((item) => `- ${item}`);
  if (portalUrl) lines.push(`Portal: ${portalUrl}`);
  return lines.join('\n');
}

// Fixed UTC offsets (minutes) for common deadline zone abbreviations.
// AOE is a fixed UTC-12 offset — never a named luxon zone (luxon has no
// AOE and throws "unsupported zone", which used to 500 this route).
const ABBR_OFFSET_MINUTES: Record<string, number> = {
  AOE: -720,
  HST: -600,
  AKST: -540,
  AKDT: -480,
  PST: -480,
  PDT: -420,
  MST: -420,
  MDT: -360,
  CST: -360,
  CDT: -300,
  EST: -300,
  EDT: -240,
  ET: -300,
  CT: -360,
  MT: -420,
  PT: -480,
  GMT: 0,
  UTC: 0,
  CET: 60,
  CEST: 120,
  BST: 60,
};

/**
 * Parse one deadline value. ISO and date-only strings go through Date
 * directly; a trailing zone abbreviation ("December 15, 2026 11:59 PM
 * AOE", "2026-12-15 EST") interprets the wall clock in that fixed offset.
 * Returns null for anything unparseable.
 */
export function parseDeadline(raw: string): Date | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;
  const m = raw.match(/^(.*?)\s*([A-Za-z]{1,5})$/);
  if (!m) return null;
  const offsetMin = ABBR_OFFSET_MINUTES[m[2].toUpperCase()];
  if (offsetMin === undefined) return null;
  const wall = new Date(m[1].trim());
  if (Number.isNaN(wall.getTime())) return null;
  // Rebase the wall clock (parsed in server-local time) to UTC, then
  // apply the abbreviation's fixed offset. getTimezoneOffset is
  // UTC-minus-local, so wall-as-UTC subtracts it; server tz cancels out.
  const utcMs = wall.getTime() - wall.getTimezoneOffset() * 60_000 - offsetMin * 60_000;
  return new Date(utcMs);
}

/**
 * POST /api/calendar/ics — approved export only.
 * Body: { title: string, deadlines: string[] (ISO, date-only, or a common
 * zone abbreviation like AOE/EST), items?: string[], portalUrl?: string|null }
 * Builds prep (14d before), final-push (3d before) and deadline-day events
 * with deterministic UIDs, so re-importing never duplicates.
 */
export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body.');
  }
  const input = (body ?? {}) as { title?: unknown; deadlines?: unknown; items?: unknown; portalUrl?: unknown };
  if (typeof input.title !== 'string' || input.title.trim().length === 0) {
    return badRequest('title is required.');
  }
  if (!Array.isArray(input.deadlines) || input.deadlines.length === 0) {
    return badRequest('At least one dated deadline is required — nothing to put on the calendar yet.');
  }
  if (input.deadlines.length > MAX_DEADLINES) {
    return badRequest(`At most ${MAX_DEADLINES} deadlines per file.`);
  }
  const title = input.title.trim();
  const items = Array.isArray(input.items) ? input.items.filter((i): i is string => typeof i === 'string').slice(0, MAX_ITEMS) : [];
  const portalUrl = typeof input.portalUrl === 'string' && input.portalUrl.length > 0 ? input.portalUrl : null;

  const parsed: Date[] = [];
  for (const raw of input.deadlines) {
    if (typeof raw !== 'string') return badRequest('Every deadline must be an ISO date string.');
    const d = parseDeadline(raw);
    if (!d) return badRequest(`Unparseable deadline: ${raw.slice(0, 60)}`);
    parsed.push(d);
  }

  const description = checklist(items, portalUrl);
  const events: EventAttributes[] = [];
  for (const day of parsed) {
    const iso = day.toISOString();
    const prep = new Date(day.getTime() - 14 * DAY_MS);
    const push = new Date(day.getTime() - 3 * DAY_MS);
    events.push({
      start: toArray(prep),
      duration: { hours: 1 },
      title: `Get documents ready — ${title}`,
      description,
      uid: uidFor(title, iso, 'prep'),
      status: 'CONFIRMED',
    });
    events.push({
      start: toArray(push),
      duration: { hours: 1 },
      title: `Final push — ${title}`,
      description,
      uid: uidFor(title, iso, 'push'),
      status: 'CONFIRMED',
    });
    events.push({
      start: toArray(day),
      duration: { hours: 1 },
      title: `${title} — deadline`,
      description,
      uid: uidFor(title, iso, 'deadline'),
      status: 'CONFIRMED',
    });
  }

  const { error, value } = createEvents(events);
  if (error || !value) {
    console.error('[calendar] ics build failed:', error);
    return Response.json({ error: 'Could not build the calendar file.' }, { status: 500 });
  }
  return new Response(value, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="mizzou-deadlines.ics"',
    },
  });
}
