// Google Calendar sync (PROMPT.md 7.3, M7). Pure except for the injected
// fetch, so every path is node-testable with no network and no keys.
// Incremental consent happens in the UI: this module only spends a token
// it is given. Event ids are lowercase base32hex of the same
// sha256(title|iso|kind) hash the ledger uses, so re-approvals address the
// same events: a 409 on insert is treated as success and the existing event
// is patched. 401/403 (declined scope, unverified app) surfaces as blocked
// and the UI falls back to .ics plus Add-to-Google-Calendar links.

import { createHash } from 'node:crypto';
import { eventIdFor, shortDate } from './plan-sync.ts';

export { GOOGLE_CALENDAR_SCOPE } from './google-scopes.ts';
export const CALENDAR_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
export const MAX_SYNC_DEADLINES = 10;

const BASE32HEX = '0123456789abcdefghijklmnopqrstuv';

/** Lowercase base32hex (RFC 4648, no padding) of raw bytes. */
export function base32hexEncode(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32HEX[(value >>> bits) & 31];
    }
  }
  if (bits > 0) out += BASE32HEX[(value << (5 - bits)) & 31];
  return out;
}

/** Deterministic Calendar event id from the same hash as the ledger row. */
export function googleEventIdFor(title: string, iso: string, kind: string): string {
  const digest = createHash('sha256').update(`${title}|${iso}|${kind}`).digest();
  return base32hexEncode(digest);
}

export interface CalendarEventInput {
  title: string;
  iso: string;
  portalUrl: string | null;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  /** All-day start, YYYYMMDD. */
  startDate: string;
  /** All-day end (exclusive), YYYYMMDD. */
  endDate: string;
}

function ymdUTC(d: Date): string {
  return (
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}` + `${String(d.getUTCDate()).padStart(2, '0')}`
  );
}

/** Build the all-day event resource, or null when the date is unusable. */
export function eventResource(input: CalendarEventInput): CalendarEvent | null {
  const at = new Date(input.iso);
  if (Number.isNaN(at.getTime())) return null;
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const end = new Date(start.getTime() + 86400000);
  return {
    id: googleEventIdFor(input.title, input.iso, 'deadline'),
    summary: input.title,
    description: input.portalUrl ? `Application deadline. Portal: ${input.portalUrl}` : 'Application deadline.',
    startDate: ymdUTC(start),
    endDate: ymdUTC(end),
  };
}

/** Add-to-Google-Calendar template link, or null when the date is unusable. */
export function templateLink(title: string, iso: string, details: string): string | null {
  const event = eventResource({ title, iso, portalUrl: null });
  if (!event) return null;
  const params = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${event.startDate}/${event.endDate}`, details });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export interface SyncHttpResponse {
  status: number;
  json(): Promise<unknown>;
}

export type SyncFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<SyncHttpResponse>;

export type SyncResult = 'inserted' | 'patched' | 'blocked';

/**
 * Write one event. Insert carries the deterministic id; a 409 means the
 * event is already there, so the existing event is patched and that counts
 * as success. 401/403 means the grant is missing or blocked: blocked.
 * Anything else throws a plain Error for the route to report.
 */
export async function syncEvent(fetchImpl: SyncFetch, token: string, event: CalendarEvent): Promise<SyncResult> {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const body = JSON.stringify({
    id: event.id,
    summary: event.summary,
    description: event.description,
    start: { date: event.startDate },
    end: { date: event.endDate },
  });
  const inserted = await fetchImpl(CALENDAR_EVENTS_URL, { method: 'POST', headers, body });
  if (inserted.status === 200 || inserted.status === 201) return 'inserted';
  if (inserted.status === 401 || inserted.status === 403) return 'blocked';
  if (inserted.status === 409) {
    const patched = await fetchImpl(`${CALENDAR_EVENTS_URL}/${event.id}`, { method: 'PATCH', headers, body });
    if (patched.status === 200 || patched.status === 201) return 'patched';
    if (patched.status === 401 || patched.status === 403) return 'blocked';
    throw new Error(`Google Calendar patch failed with status ${patched.status}.`);
  }
  throw new Error(`Google Calendar insert failed with status ${inserted.status}.`);
}

export interface CalendarSyncInput {
  title?: unknown;
  deadlines?: unknown;
  portalUrl?: unknown;
}

export interface CalendarSyncPlan {
  title: string;
  events: CalendarEventInput[];
}

export type CalendarSyncValidation = { plan: CalendarSyncPlan } | { error: string };

/** Validate a sync body into dated events (same caps as the plan writes). */
export function validateSyncInput(input: CalendarSyncInput): CalendarSyncValidation {
  if (typeof input.title !== 'string' || input.title.trim().length === 0) {
    return { error: 'title is required.' };
  }
  const deadlines = Array.isArray(input.deadlines)
    ? input.deadlines.filter((d): d is string => typeof d === 'string')
    : [];
  const portalUrl = typeof input.portalUrl === 'string' ? input.portalUrl : null;
  const events = deadlines
    .slice(0, MAX_SYNC_DEADLINES)
    .map((iso) => ({ title: input.title as string, iso, portalUrl }))
    .filter((e) => eventResource(e) !== null);
  if (events.length === 0) return { error: 'No usable dates to sync.' };
  return { plan: { title: (input.title as string).trim(), events } };
}

export interface SyncLedgerRow {
  eventId: string;
  provider: string;
  status: string;
  payload: Record<string, unknown>;
}

export interface CalendarSyncDeps {
  getToken: () => Promise<string | null>;
  upsertLedger: (rows: SyncLedgerRow[]) => Promise<void>;
  fetchImpl: SyncFetch;
}

export interface CalendarFallbackLink {
  iso: string;
  label: string;
  url: string;
}

export type CalendarSyncResult =
  | { ok: true; synced: number; blocked: number; links: CalendarFallbackLink[] }
  | { ok: false; reason: 'needs-consent' | 'blocked' | 'error'; message: string; links: CalendarFallbackLink[] };

/**
 * Sync every dated event, then record one ledger row per written event
 * (hex ledger id, Google id in the payload). No token means the grant was
 * never given: needs-consent. All-blocked means declined or unverified-app:
 * blocked, and the UI falls back.
 */
export async function runCalendarSync(deps: CalendarSyncDeps, input: CalendarSyncInput): Promise<CalendarSyncResult> {
  const validated = validateSyncInput(input);
  if ('error' in validated) return { ok: false, reason: 'error', message: validated.error, links: [] };
  const resources = validated.plan.events
    .map((item) => ({ item, event: eventResource(item) }))
    .filter((r): r is { item: CalendarEventInput; event: CalendarEvent } => r.event !== null);
  const links: CalendarFallbackLink[] = [];
  for (const r of resources) {
    const details = r.item.portalUrl ? `Application deadline. Portal: ${r.item.portalUrl}` : 'Application deadline.';
    const url = templateLink(r.item.title, r.item.iso, details);
    if (url) links.push({ iso: r.item.iso, label: shortDate(r.item.iso), url });
  }
  const token = await deps.getToken();
  if (!token) return { ok: false, reason: 'needs-consent', message: 'Calendar access was not granted yet.', links };
  let synced = 0;
  let blocked = 0;
  const rows: SyncLedgerRow[] = [];
  try {
    for (const { item, event } of resources) {
      const result = await syncEvent(deps.fetchImpl, token, event);
      if (result === 'blocked') {
        blocked += 1;
        continue;
      }
      synced += 1;
      rows.push({
        eventId: eventIdFor(item.title, item.iso, 'deadline'),
        provider: 'google',
        status: 'synced',
        payload: { title: item.title, iso: item.iso, googleEventId: event.id, via: result },
      });
    }
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Calendar sync failed.', links };
  }
  if (rows.length > 0) await deps.upsertLedger(rows);
  if (synced === 0 && blocked > 0) {
    return { ok: false, reason: 'blocked', message: 'Google blocked the write. The .ics download still works.', links };
  }
  return { ok: true, synced, blocked, links };
}
