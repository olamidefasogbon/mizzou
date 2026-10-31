// Approve & Sync writes: validation, caps, deterministic ledger ids, and
// the client contract (guest incremental consent, public .ics).
// Run: node --test src/lib/plan-sync.test.ts (from apps/web).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlanWrites, eventIdFor, shortDate } from './plan-sync.ts';

const here = dirname(fileURLToPath(import.meta.url));

describe('buildPlanWrites', () => {
  it('rejects a missing title and an empty plan', () => {
    assert.deepEqual(buildPlanWrites({}), { error: 'title is required.' });
    assert.deepEqual(buildPlanWrites({ title: '  ' }), { error: 'title is required.' });
    assert.deepEqual(buildPlanWrites({ title: 'MS', deadlines: [], items: [] }), { error: 'Nothing to sync.' });
  });

  it('writes one dated reminder plus one deterministic ledger row per deadline', () => {
    const out = buildPlanWrites({ title: 'MS', deadlines: ['2026-12-01T00:00:00.000Z'], items: [] });
    assert.ok(!('error' in out));
    assert.equal(out.reminders.length, 2);
    assert.deepEqual(out.reminders.map((r) => r.kind), ['custom', 'check_again']);
    assert.equal(out.reminders[0]?.dueAt, '2026-12-01T00:00:00.000Z');
    assert.equal(out.reminders[0]?.kind, 'custom');
    assert.equal(out.ledger.length, 1);
    assert.equal(out.ledger[0]?.eventId, eventIdFor('MS', '2026-12-01T00:00:00.000Z', 'deadline'));
    assert.equal(out.ledger[0]?.provider, 'google');
  });

  it('caps deadlines at 10 and items at 50', () => {
    const out = buildPlanWrites({
      title: 'MS',
      deadlines: Array.from({ length: 30 }, (_, i) => `2026-12-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`),
      items: Array.from({ length: 80 }, (_, i) => `task ${i}`),
    });
    assert.ok(!('error' in out));
    assert.equal(out.reminders.length, 61);
    assert.equal(out.ledger.length, 10);
  });

  it('task reminders carry no date and no ledger row', () => {
    const out = buildPlanWrites({ title: 'MS', items: ['Get transcripts'] });
    assert.ok(!('error' in out));
    assert.deepEqual(out.reminders, [{ title: 'MS', sub: 'Get transcripts', pill: 'Task', dueAt: null, kind: 'custom' }]);
    assert.deepEqual(out.ledger, []);
  });

  it('event ids are deterministic: same plan, same id', () => {
    const a = eventIdFor('MS', '2026-12-01T00:00:00.000Z', 'deadline');
    const b = eventIdFor('MS', '2026-12-01T00:00:00.000Z', 'deadline');
    assert.equal(a, b);
    assert.notEqual(a, eventIdFor('MS', '2026-12-02T00:00:00.000Z', 'deadline'));
  });

  it('shortDate pills a month and day', () => {
    assert.match(shortDate('2026-12-01T00:00:00.000Z'), /Dec/);
    assert.equal(shortDate('not a date'), 'Dated');
  });
});

describe('approve and sync contract', () => {
  const page = readFileSync(join(here, '../app/app/c/[chatId]/page.tsx'), 'utf8');
  const callback = readFileSync(join(here, '../app/auth/callback/route.ts'), 'utf8');
  const ics = readFileSync(join(here, '../app/api/calendar/ics/route.ts'), 'utf8');

  it('guests link Google at sync time and return to the chat', () => {
    assert.match(page, /isGuest/);
    assert.match(page, /upgradeToGoogle\(supabaseBrowser\(\)\.auth, window\.location\.origin, `\/app\/c\/\$\{chatId\}`, GOOGLE_CALENDAR_SCOPE\)/);
  });

  it('the callback returns to the approved chat, same-origin only', () => {
    assert.match(callback, /startsWith\('\/app'\)/);
  });

  it('the .ics download has no auth gate: it works for everyone', () => {
    assert.doesNotMatch(ics, /resolveUser|AuthRequired/);
  });
});

describe('check-again reminders', () => {
  it('adds a 7-day check-again row when the opening date is unpublished', () => {
    const before = Date.now();
    const out = buildPlanWrites({ title: 'MS', deadlines: ['2026-12-01T00:00:00.000Z'], items: [], opens: null });
    assert.ok(!('error' in out));
    const check = out.reminders.filter((r) => r.kind === 'check_again');
    assert.equal(check.length, 1);
    assert.match(check[0]?.sub ?? '', /check again/);
    assert.equal(check[0]?.pill, 'Soon');
    const due = Date.parse(check[0]?.dueAt ?? '');
    assert.ok(due - before > 6.9 * 86400000 && due - before < 7.1 * 86400000);
  });

  it('skips the check-again row when the opening date is known', () => {
    const out = buildPlanWrites({ title: 'MS', deadlines: ['2026-12-01T00:00:00.000Z'], items: [], opens: '2026-09-01T00:00:00.000Z' });
    assert.ok(!('error' in out));
    assert.equal(out.reminders.filter((r) => r.kind === 'check_again').length, 0);
  });

  it('skips the check-again row when there is nothing dated', () => {
    const out = buildPlanWrites({ title: 'MS', items: ['Get transcripts'], opens: null });
    assert.ok(!('error' in out));
    assert.equal(out.reminders.filter((r) => r.kind === 'check_again').length, 0);
  });
});
