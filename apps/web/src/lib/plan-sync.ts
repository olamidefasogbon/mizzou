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
}

/** Short pill date for a deadline instant; 'Dated' when unparseable. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Dated';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
  for (const iso of deadlines.slice(0, MAX_SYNC_DEADLINES)) {
    reminders.push({ title, sub: 'Application deadline', pill: shortDate(iso), dueAt: iso, kind: 'custom' });
    ledger.push({
      eventId: eventIdFor(title, iso, 'deadline'),
      provider: 'google',
      status: 'synced',
      payload: { title, iso },
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
