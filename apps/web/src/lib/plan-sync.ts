// Plan approval writes (pure, node-testable): Approve & Sync turns a plan
// card into dated reminders plus one idempotent calendar-ledger row per
// deadline. Deterministic event ids (same scheme as the .ics uidFor) make
// repeat approvals a no-op instead of duplicates.

import { createHash } from 'node:crypto';
import { OPENING_CHECK_AGAIN } from '@mizzou/core/voice';

export const MAX_SYNC_DEADLINES = 10;
export const MAX_SYNC_ITEMS = 50;

export interface PlanReminderWrite {
  title: string;
  sub: string;
  pill: string;
  dueAt: string | null;
  kind: string;
}

export interface PlanLedgerWrite {
  eventId: string;
  provider: string;
  status: string;
  payload: Record<string, unknown>;
}

export interface PlanSyncInput {
  title?: unknown;
  deadlines?: unknown;
  items?: unknown;
  opens?: unknown;
  /** Track or program label from the extraction (e.g. Fall 2027); shown in deadline titles. */
  label?: unknown;
}

/** Short pill date for a deadline instant; 'Dated' when unparseable. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Dated';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Reminder pill for a deadline instant: the year when it is not the current
 * year, a relative form when it is near, 'Today' on the day, 'Passed' once
 * it is over, and 'Dated' when unparseable. nowMs is injectable for tests.
 */
export function pillFor(iso: string, nowMs: number = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Dated';
  const day = (t: number): number => {
    const x = new Date(t);
    return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  };
  const days = Math.round((day(d.getTime()) - day(nowMs)) / 86400000);
  if (days < 0) return 'Passed';
  if (days === 0) return 'Today';
  if (days <= 30) return `in ${days} day${days === 1 ? '' : 's'}`;
  if (d.getUTCFullYear() !== new Date(nowMs).getUTCFullYear()) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Deterministic calendar event id: sha256 hex of title|iso|kind.
 * Re-approving the same plan yields the same ids, so the ledger upsert
 * (unique on user_id + event_id) never duplicates events.
 */
export function eventIdFor(title: string, iso: string, kind: string): string {
  return createHash('sha256').update(`${title}|${iso}|${kind}`).digest('hex');
}

export type PlanSyncResult =
  | { reminders: PlanReminderWrite[]; ledger: PlanLedgerWrite[] }
  | { error: string };

/**
 * Validate an Approve & Sync body into reminder + ledger writes.
 * Deadline reminders use kind 'custom' (the only date-neutral kind the
 * reminders table check constraint accepts); the pill carries the date.
 */
export function buildPlanWrites(input: PlanSyncInput): PlanSyncResult {
  if (typeof input.title !== 'string' || input.title.trim().length === 0) {
    return { error: 'title is required.' };
  }
  const title = input.title.trim();
  const deadlines = Array.isArray(input.deadlines)
    ? input.deadlines.filter((d): d is string => typeof d === 'string')
    : [];
  const items = Array.isArray(input.items) ? input.items.filter((i): i is string => typeof i === 'string') : [];
  if (deadlines.length === 0 && items.length === 0) {
    return { error: 'Nothing to sync.' };
  }
  const reminders: PlanReminderWrite[] = [];
  const ledger: PlanLedgerWrite[] = [];
  const label = typeof input.label === 'string' && input.label.trim().length > 0 ? input.label.trim().slice(0, 80) : '';
  const deadlineTitle = label ? `${title} (${label})` : title;
  for (const iso of deadlines.slice(0, MAX_SYNC_DEADLINES)) {
    reminders.push({ title: deadlineTitle, sub: 'Application deadline', pill: pillFor(iso), dueAt: iso, kind: 'custom' });
    ledger.push({
      eventId: eventIdFor(deadlineTitle, iso, 'deadline'),
      provider: 'google',
      status: 'synced',
      payload: { title: deadlineTitle, iso },
    });
  }
  for (const task of items.slice(0, MAX_SYNC_ITEMS)) {
    reminders.push({ title, sub: task, pill: 'Task', dueAt: null, kind: 'custom' });
  }
  if ((input.opens === null || input.opens === undefined || input.opens === '') && deadlines.length > 0) {
    reminders.push({
      title,
      sub: OPENING_CHECK_AGAIN,
      pill: 'Soon',
      dueAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      kind: 'check_again',
    });
  }
  return { reminders, ledger };
}
