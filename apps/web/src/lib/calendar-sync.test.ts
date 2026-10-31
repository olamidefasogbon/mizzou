// Google Calendar sync: deterministic base32hex ids, 409-as-success with
// patch, blocked-vs-error classification, ledger rows. Mocked fetch only:
// no network, no keys, no paid calls.
// Run: node --test src/lib/calendar-sync.test.ts (from apps/web).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  base32hexEncode,
  eventResource,
  googleEventIdFor,
  runCalendarSync,
  syncEvent,
  templateLink,
  type CalendarEvent,
  type SyncFetch,
} from './calendar-sync.ts';
import { eventIdFor } from './plan-sync.ts';

function scriptedFetch(script: Array<{ status: number; body?: unknown }>, seen: Array<{ url: string; init: unknown }>): SyncFetch {
  let n = 0;
  return async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    seen.push({ url, init });
    const next = script[Math.min(n, script.length - 1)] ?? { status: 500 };
    n += 1;
    return { status: next.status, json: async () => next.body ?? {} };
  };
}

const EVENT: CalendarEvent = {
  id: 'abc123',
  summary: 'Example MS',
  description: 'Application deadline.',
  startDate: '20261201',
  endDate: '20261202',
};

describe('base32hexEncode', () => {
  it('matches the RFC vectors in lowercase with no padding', () => {
    assert.equal(base32hexEncode(new TextEncoder().encode('f')), 'co');
    assert.equal(base32hexEncode(new TextEncoder().encode('foo')), 'cpnmu');
  });
});

describe('googleEventIdFor', () => {
  it('is deterministic lowercase base32hex over the plan hash', () => {
    const id = googleEventIdFor('MS', '2026-12-01T00:00:00.000Z', 'deadline');
    assert.match(id, /^[0-9a-v]{52}$/);
    assert.equal(id, googleEventIdFor('MS', '2026-12-01T00:00:00.000Z', 'deadline'));
    assert.notEqual(id, googleEventIdFor('MS', '2026-12-02T00:00:00.000Z', 'deadline'));
  });
});

describe('eventResource', () => {
  it('builds an all-day event with an exclusive end date', () => {
    const event = eventResource({ title: 'MS', iso: '2026-12-01T04:59:59.000Z', portalUrl: 'https://example.edu/apply' });
    assert.ok(event);
    assert.equal(event.startDate, '20261201');
    assert.equal(event.endDate, '20261202');
    assert.match(event.id, /^[0-9a-v]{52}$/);
    assert.match(event.description, /example\.edu\/apply/);
  });

  it('returns null for unusable dates', () => {
    assert.equal(eventResource({ title: 'MS', iso: 'not a date', portalUrl: null }), null);
  });
});

describe('templateLink', () => {
  it('builds an Add-to-Google-Calendar link with the deadline window', () => {
    const link = templateLink('MS', '2026-12-01T00:00:00.000Z', 'Apply now');
    assert.ok(link);
    assert.match(link, /calendar\.google\.com\/calendar\/render/);
    assert.match(link, /dates=20261201%2F20261202/);
  });

  it('returns null for unusable dates', () => {
    assert.equal(templateLink('MS', 'garbage', 'x'), null);
  });
});

describe('syncEvent', () => {
  it('inserts with the deterministic id and bearer token', async () => {
    const seen2: Array<{ url: string; init: unknown }> = [];
    const result = await syncEvent(scriptedFetch([{ status: 200 }], seen2), 'tok', EVENT);
    assert.equal(result, 'inserted');
    assert.equal(seen2.length, 1);
    const init = seen2[0]?.init as { headers: Record<string, string>; body: string };
    assert.equal(init.headers['Authorization'], 'Bearer tok');
    assert.match(init.body, /"id":"abc123"/);
  });

  it('treats a 409 as success and patches the existing event', async () => {
    const seen: Array<{ url: string; init: unknown }> = [];
    const result = await syncEvent(scriptedFetch([{ status: 409 }, { status: 200 }], seen), 'tok', EVENT);
    assert.equal(result, 'patched');
    assert.equal(seen.length, 2);
    assert.equal(seen[0]?.url, 'https://www.googleapis.com/calendar/v3/calendars/primary/events');
    assert.equal(seen[1]?.url, 'https://www.googleapis.com/calendar/v3/calendars/primary/events/abc123');
    assert.equal((seen[1]?.init as { method: string }).method, 'PATCH');
  });

  it('reports blocked on 401 without retrying', async () => {
    const seen: Array<{ url: string; init: unknown }> = [];
    assert.equal(await syncEvent(scriptedFetch([{ status: 401 }], seen), 'tok', EVENT), 'blocked');
    assert.equal(seen.length, 1);
  });

  it('throws on a 500 so the route reports instead of swallowing', async () => {
    await assert.rejects(syncEvent(scriptedFetch([{ status: 500 }], []), 'tok', EVENT), /status 500/);
  });
});

describe('runCalendarSync', () => {
  it('asks for consent when no token exists and never calls Google', async () => {
    const seen: Array<{ url: string; init: unknown }> = [];
    let tokens = 0;
    const out = await runCalendarSync(
      { getToken: async () => { tokens += 1; return null; }, upsertLedger: async () => {}, fetchImpl: scriptedFetch([{ status: 200 }], seen) },
      { title: 'MS', deadlines: ['2026-12-01T00:00:00.000Z'] },
    );
    assert.equal(out.ok, false);
    if (out.ok === false) {
      assert.equal(out.reason, 'needs-consent');
      assert.equal(out.links.length, 1);
      assert.match(out.links[0]?.url ?? '', /calendar\.google\.com/);
    }
    assert.equal(tokens, 1);
    assert.equal(seen.length, 0);
  });

  it('syncs through a 409 and records the hex ledger id with the Google id', async () => {
    const seen: Array<{ url: string; init: unknown }> = [];
    const rows: Array<{ eventId: string; payload: Record<string, unknown> }> = [];
    const out = await runCalendarSync(
      {
        getToken: async () => 'tok',
        upsertLedger: async (r) => { rows.push(...(r as Array<{ eventId: string; payload: Record<string, unknown> }>)); },
        fetchImpl: scriptedFetch([{ status: 409 }, { status: 200 }], seen),
      },
      { title: 'MS', deadlines: ['2026-12-01T00:00:00.000Z'], portalUrl: 'https://example.edu/apply' },
    );
    assert.equal(out.ok, true);
    if (out.ok === true) {
      assert.equal(out.synced, 1);
      assert.equal(out.blocked, 0);
      assert.equal(out.links.length, 1);
    }
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.eventId, eventIdFor('MS', '2026-12-01T00:00:00.000Z', 'deadline'));
    assert.match(String(rows[0]?.payload['googleEventId']), /^[0-9a-v]{52}$/);
    assert.equal(rows[0]?.payload['via'], 'patched');
  });

  it('reports blocked when Google refuses every write and writes no ledger', async () => {
    const rows: unknown[] = [];
    const out = await runCalendarSync(
      { getToken: async () => 'tok', upsertLedger: async (r) => { rows.push(...r); }, fetchImpl: scriptedFetch([{ status: 403 }], []) },
      { title: 'MS', deadlines: ['2026-12-01T00:00:00.000Z'] },
    );
    assert.equal(out.ok, false);
    assert.equal(rows.length, 0);
    if (!out.ok) assert.equal(out.reason, 'blocked');
  });

  it('rejects bodies with no usable dates', async () => {
    const out = await runCalendarSync(
      { getToken: async () => 'tok', upsertLedger: async () => {}, fetchImpl: scriptedFetch([{ status: 200 }], []) },
      { title: 'MS', deadlines: ['garbage'] },
    );
    assert.equal(out.ok, false);
  });
});
