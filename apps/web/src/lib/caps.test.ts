// Abuse caps: env defaults, message/upload verdicts, IP hashing, and the
// Supabase counter store against a fake DbClient. No network, no keys.
// Run: node --test src/lib/caps.test.ts (from apps/web).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  abuseLimitsFromEnv,
  checkHitRate,
  checkMessageLength,
  checkNewRun,
  checkUploadSize,
  clientIp,
  dayStamp,
  hashIp,
  minuteStamp,
  supabaseCounterStore,
  type CounterStore,
  type DbClient,
} from './caps.ts';

function memoryStore(): CounterStore & { counts: Map<string, number> } {
  const counts = new Map<string, number>();
  return {
    counts,
    get: async (key, windowStart) => counts.get(`${key}|${windowStart}`) ?? 0,
    increment: async (key, windowStart) => {
      const k = `${key}|${windowStart}`;
      const next = (counts.get(k) ?? 0) + 1;
      counts.set(k, next);
      return next;
    },
  };
}

describe('abuse limits from env', () => {
  it('defaults every cap when env is empty', () => {
    const limits = abuseLimitsFromEnv({});
    assert.deepEqual(limits, {
      maxMessageChars: 4000,
      maxRunsPerIpPerDay: 50,
      maxHitsPerIpPerMinute: 20,
      maxPagesPerRun: 25,
      maxUploadBytes: 8 * 1024 * 1024,
    });
  });

  it('reads every cap from env', () => {
    const limits = abuseLimitsFromEnv({
      MAX_MESSAGE_CHARS: '100',
      MAX_RUNS_PER_IP_PER_DAY: '5',
      MAX_HITS_PER_IP_PER_MINUTE: '3',
      MAX_PAGES_PER_RUN: '7',
      MAX_UPLOAD_BYTES: '1024',
    });
    assert.deepEqual(limits, {
      maxMessageChars: 100,
      maxRunsPerIpPerDay: 5,
      maxHitsPerIpPerMinute: 3,
      maxPagesPerRun: 7,
      maxUploadBytes: 1024,
    });
  });
});

describe('message and upload verdicts', () => {
  it('refuses an over-long message with a friendly model-free line', () => {
    const v = checkMessageLength('x'.repeat(4001));
    assert.equal(v.ok, false);
    if (!v.ok) assert.match(v.message, /too long/);
    assert.deepEqual(checkMessageLength('hello'), { ok: true });
  });

  it('refuses an over-size upload with a friendly model-free line', () => {
    const v = checkUploadSize(9 * 1024 * 1024);
    assert.equal(v.ok, false);
    if (!v.ok) assert.match(v.message, /too big/);
    assert.deepEqual(checkUploadSize(1024), { ok: true });
  });
});

describe('ip handling', () => {
  it('reads the first forwarded address', () => {
    const req = new Request('https://mizzou.test/api/chat', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } });
    assert.equal(clientIp(req), '1.2.3.4');
    assert.equal(clientIp(new Request('https://mizzou.test/api/chat')), 'unknown');
  });

  it('hashes stably and never embeds the raw ip', () => {
    const a = hashIp('1.2.3.4');
    assert.equal(a, hashIp('1.2.3.4'));
    assert.notEqual(a, hashIp('5.6.7.8'));
    assert.ok(!a.includes('1.2.3.4'));
  });

  it('stamps UTC day and minute windows', () => {
    const d = new Date('2026-10-31T13:05:22.000Z');
    assert.equal(dayStamp(d), '2026-10-31');
    assert.equal(minuteStamp(d), '2026-10-31T13:05');
  });
});

describe('hit and run verdicts', () => {
  it('allows hits up to the per-minute limit, then says I need a minute', async () => {
    const store = memoryStore();
    const limits = abuseLimitsFromEnv({ MAX_HITS_PER_IP_PER_MINUTE: '2' });
    assert.deepEqual(await checkHitRate(store, '1.2.3.4', limits), { ok: true });
    assert.deepEqual(await checkHitRate(store, '1.2.3.4', limits), { ok: true });
    const blocked = await checkHitRate(store, '1.2.3.4', limits);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.message, 'I need a minute.');
  });

  it('names tomorrow when the per-IP daily run budget is hit', async () => {
    const store = memoryStore();
    const limits = abuseLimitsFromEnv({ MAX_RUNS_PER_IP_PER_DAY: '1' });
    assert.deepEqual(await checkNewRun(store, '9.9.9.9', limits), { ok: true });
    const blocked = await checkNewRun(store, '9.9.9.9', limits);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.match(blocked.message, /tomorrow/);
  });

  it('counts ips independently', async () => {
    const store = memoryStore();
    const limits = abuseLimitsFromEnv({ MAX_RUNS_PER_IP_PER_DAY: '1' });
    await checkNewRun(store, '1.1.1.1', limits);
    assert.deepEqual(await checkNewRun(store, '2.2.2.2', limits), { ok: true });
  });
});

describe('supabase counter store', () => {
  function fakeDb(): { client: DbClient; rows: Array<Record<string, unknown>> } {
    const rows: Array<Record<string, unknown>> = [];
    const client: DbClient = {
      from: (table: string) => {
        assert.equal(table, 'rate_counters');
        const filters: Array<{ col: string; val: unknown }> = [];
        const table_api = {
          select: () => table_api,
          eq: (col: string, val: unknown) => {
            filters.push({ col, val });
            return table_api;
          },
          limit: () => table_api,
          upsert: async (incoming: unknown[]) => {
            for (const row of incoming as Array<Record<string, unknown>>) {
              const i = rows.findIndex((r) => r['key'] === row['key'] && r['window_start'] === row['window_start']);
              if (i >= 0) rows[i] = { ...rows[i], ...row };
              else rows.push({ ...row });
            }
            return { data: incoming, error: null };
          },
          then: (resolve: (v: { data: Array<Record<string, unknown>>; error: null }) => unknown) => {
            const matched = rows.filter((r) => filters.every((f) => r[f.col] === f.val));
            return Promise.resolve({ data: matched, error: null }).then(resolve);
          },
        };
        return table_api as unknown as ReturnType<DbClient['from']>;
      },
    };
    return { client, rows };
  }

  it('reads zero for a fresh key and increments through upsert', async () => {
    const { client, rows } = fakeDb();
    const store = supabaseCounterStore(client);
    assert.equal(await store.get('k', 'w'), 0);
    assert.equal(await store.increment('k', 'w'), 1);
    assert.equal(await store.increment('k', 'w'), 2);
    assert.equal(await store.get('k', 'w'), 2);
    assert.equal(rows.length, 1);
  });
});
