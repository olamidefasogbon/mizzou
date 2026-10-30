// Run: node --test src/app/api/calendar/ics/ics.test.ts (from apps/web).
// Covers the AOE fixed-offset rule and common abbreviations.
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { POST, parseDeadline } from './route.ts';

async function post(body: unknown): Promise<{ status: number; text: string; json: unknown }> {
  const res = await POST(new Request('https://mizzou.test/api/calendar/ics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    json = null;
  }
  return { status: res.status, text, json };
}

describe('parseDeadline', () => {
  it('passes ISO instants through untouched', () => {
    assert.equal(parseDeadline('2026-12-16T04:59:59Z')?.toISOString(), '2026-12-16T04:59:59.000Z');
  });

  it('maps AOE to a fixed UTC-12 offset, never a named zone', () => {
    // 11:59 PM Dec 15 AOE == 11:59 UTC Dec 16.
    assert.equal(parseDeadline('December 15, 2026 11:59 PM AOE')?.toISOString(), '2026-12-16T11:59:00.000Z');
  });

  it('maps common US abbreviations to their fixed offsets', () => {
    assert.equal(parseDeadline('December 15, 2026 11:59 PM EST')?.toISOString(), '2026-12-16T04:59:00.000Z');
    assert.equal(parseDeadline('December 15, 2026 11:59 PM PST')?.toISOString(), '2026-12-16T07:59:00.000Z');
  });

  it('rejects unknown zones and garbage', () => {
    assert.equal(parseDeadline('December 15, 2026 XYZ'), null);
    assert.equal(parseDeadline('not a date'), null);
    assert.equal(parseDeadline(''), null);
  });
});

describe('POST /api/calendar/ics', () => {
  it('builds a calendar file for ISO deadlines', async () => {
    const res = await post({ title: 'Test Program', deadlines: ['2026-12-16T04:59:59Z'] });
    assert.equal(res.status, 200);
    assert.match(res.text, /BEGIN:VCALENDAR/);
    // The deadline-day event lands on Dec 16 (9am event hour is server-local).
    assert.match(res.text, /DTSTART:20261216T\d{6}Z/);
  });

  it('accepts an AOE deadline string', async () => {
    const res = await post({ title: 'Test Program', deadlines: ['December 15, 2026 11:59 PM AOE'] });
    assert.equal(res.status, 200);
    assert.match(res.text, /DTSTART:20261216T\d{6}Z/);
  });

  it('rejects unparseable deadlines with a 400', async () => {
    const res = await post({ title: 'Test Program', deadlines: ['December 15, 2026 XYZ'] });
    assert.equal(res.status, 400);
    assert.match(String((res.json as { error?: string } | null)?.error ?? ''), /Unparseable deadline/);
  });

  it('requires a title and at least one deadline', async () => {
    assert.equal((await post({ title: '', deadlines: ['2026-12-16T04:59:59Z'] })).status, 400);
    assert.equal((await post({ title: 'T', deadlines: [] })).status, 400);
  });
});
