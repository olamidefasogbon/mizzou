// Server-side abuse caps for no-signup traffic (restores and extends the
// deleted guest caps module). Every limit reads from env; every count lives
// in Supabase (rate_counters via the service role), never in process memory,
// so caps survive serverless. Server-only: route handlers and actions.
//
// Cap order per chat turn: message length, per-minute rate, per-IP daily
// runs (new runs only), then the USD budgets inside the turn. Verdicts carry
// model-free friendly text: transient pressure says "I need a minute.",
// exhausted daily budgets name tomorrow.

import 'server-only';

import { createHash } from 'node:crypto';

import type { DbClient } from './repo.ts';

export interface AbuseLimits {
  maxMessageChars: number;
  maxRunsPerIpPerDay: number;
  maxHitsPerIpPerMinute: number;
  maxPagesPerRun: number;
  maxUploadBytes: number;
}

export function abuseLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): AbuseLimits {
  const num = (v: string | undefined, fallback: number): number => {
    const n = v === undefined ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    maxMessageChars: num(env.MAX_MESSAGE_CHARS, 4000),
    maxRunsPerIpPerDay: num(env.MAX_RUNS_PER_IP_PER_DAY, 50),
    maxHitsPerIpPerMinute: num(env.MAX_HITS_PER_IP_PER_MINUTE, 20),
    maxPagesPerRun: num(env.MAX_PAGES_PER_RUN, 25),
    maxUploadBytes: num(env.MAX_UPLOAD_BYTES, 8 * 1024 * 1024),
  };
}

/** First entry of x-forwarded-for; 'unknown' when the header is absent. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first && first.length > 0 ? first : 'unknown';
}

/** One-way hash of an IP for counter keys. Raw IPs are never stored. */
export function hashIp(ip: string, salt = process.env.IP_HASH_SALT ?? ''): string {
  return createHash('sha256').update(`${salt}${ip}`).digest('hex');
}

export function dayStamp(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function minuteStamp(d = new Date()): string {
  return d.toISOString().slice(0, 16);
}

export interface CapDetail {
  scope: string;
  amount: number;
  limit: number;
}

export type CapVerdict = { ok: true } | { ok: false; message: string; detail: CapDetail };

/** Server-side refusal line: scope, amount and limit, never user content. */
export function logCapRefusal(detail: CapDetail): void {
  console.warn(`[mizzou:caps] refusal scope=${detail.scope} amount=${detail.amount} limit=${detail.limit}`);
}

/** Model-free refusal for an over-long message. */
export function checkMessageLength(text: string, limits: AbuseLimits = abuseLimitsFromEnv()): CapVerdict {
  if (text.length > limits.maxMessageChars) {
    return {
      ok: false,
      message: `Your message is too long (over ${limits.maxMessageChars} characters). Shorten it and try again.`,
      detail: { scope: 'message-chars', amount: text.length, limit: limits.maxMessageChars },
    };
  }
  return { ok: true };
}

/** Model-free refusal for an over-size upload (enforced when uploads ship). */
export function checkUploadSize(bytes: number, limits: AbuseLimits = abuseLimitsFromEnv()): CapVerdict {
  if (bytes > limits.maxUploadBytes) {
    return {
      ok: false,
      message: 'That file is too big. Try one under 8 MB.',
      detail: { scope: 'upload-bytes', amount: bytes, limit: limits.maxUploadBytes },
    };
  }
  return { ok: true };
}

export interface CounterStore {
  get(key: string, windowStart: string): Promise<number>;
  increment(key: string, windowStart: string): Promise<number>;
}

/**
 * Supabase-backed counters (service role: the table has RLS enabled with
 * no policies, so only the service role reads and writes). Get-then-upsert
 * is best-effort under concurrency — exact enough for abuse accounting.
 */
export function supabaseCounterStore(db: DbClient): CounterStore {
  const read = async (key: string, windowStart: string): Promise<number> => {
    const res = await db
      .from('rate_counters')
      .select('count')
      .eq('key', key)
      .eq('window_start', windowStart)
      .limit(1);
    const row = res.data?.[0];
    const n = typeof row?.['count'] === 'number' ? (row['count'] as number) : Number(row?.['count'] ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    get: read,
    increment: async (key, windowStart) => {
      const next = (await read(key, windowStart)) + 1;
      await db
        .from('rate_counters')
        .upsert([{ key, window_start: windowStart, count: next }], { onConflict: 'key,window_start' });
      return next;
    },
  };
}

/** Per-minute pressure valve: transient, so the minute message applies. */
export async function checkHitRate(store: CounterStore, ip: string, limits: AbuseLimits = abuseLimitsFromEnv()): Promise<CapVerdict> {
  const count = await store.increment(`ip:${hashIp(ip)}:hit`, minuteStamp());
  if (count > limits.maxHitsPerIpPerMinute) {
    return { ok: false, message: 'I need a minute.', detail: { scope: 'hits-per-minute', amount: count, limit: limits.maxHitsPerIpPerMinute } };
  }
  return { ok: true };
}

/** Per-IP daily run budget for anonymous traffic: names tomorrow. */
export async function checkNewRun(store: CounterStore, ip: string, limits: AbuseLimits = abuseLimitsFromEnv()): Promise<CapVerdict> {
  const count = await store.increment(`ip:${hashIp(ip)}:run`, dayStamp());
  if (count > limits.maxRunsPerIpPerDay) {
    return {
      ok: false,
      message: "You've reached today's run limit for your network. Try again tomorrow.",
      detail: { scope: 'runs-per-day-per-ip', amount: count, limit: limits.maxRunsPerIpPerDay },
    };
  }
  return { ok: true };
}
