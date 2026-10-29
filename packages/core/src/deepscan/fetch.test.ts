import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FETCH_TTL_MS,
  FetchTimeoutError,
  PdfContentError,
  RobotsBlockedError,
  cleanPageText,
  extractLinks,
  fetchPageText,
  isAllowed,
  parseRobots,
} from './fetch.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '..', '..', 'eval', 'fixtures');

interface StubRoute {
  status?: number;
  contentType?: string;
  body?: string;
}

function stubFetch(routes: Record<string, StubRoute>, calls: string[]) {
  return async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    const route = routes[url] ?? routes['*'] ?? { status: 404, body: 'nope' };
    const status = route.status ?? 200;
    const body = route.body ?? '';
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? (route.contentType ?? 'text/html') : null) },
      text: async () => body,
      arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
    } as unknown as Response;
  };
}

describe('extractLinks and cleanPageText on the saved EPFE fixture', () => {
  const html = readFileSync(join(FIXTURES, 'case-03.html'), 'utf-8');

  it('finds the apply link and a readable title', () => {
    const links = extractLinks(html, 'https://eee.epfl.ch/');
    expect(links.length).toBeGreaterThan(0);
    expect(links.some((l) => l.href.includes('/apply'))).toBe(true);
  });

  it('keeps deadline text and drops scripts', () => {
    const { title, text } = cleanPageText(html);
    expect(title.length).toBeGreaterThan(0);
    expect(text).toMatch(/November 1|deadline/i);
    expect(text).not.toMatch(/<script|_next\/static/);
  });
});

describe('robots.txt', () => {
  const robots = 'User-agent: *\nDisallow: /private/\n\nUser-agent: other\nDisallow:';

  it('parses groups and matches prefixes', () => {
    const groups = parseRobots(robots);
    expect(isAllowed(groups, 'Mizzou-deep-scan', '/public/page')).toBe(true);
    expect(isAllowed(groups, 'Mizzou-deep-scan', '/private/page')).toBe(false);
    expect(isAllowed(groups, 'other', '/private/page')).toBe(true);
    expect(isAllowed([], 'Mizzou-deep-scan', '/anything')).toBe(true);
  });

  it('blocks disallowed paths before fetching', async () => {
    const calls: string[] = [];
    const maps = { cache: new Map(), robotsCache: new Map(), lastFetch: new Map() };
    const fetchImpl = stubFetch({ 'https://x.example/robots.txt': { body: robots } }, calls);
    await expect(
      fetchPageText('https://x.example/private/page', { fetchImpl, minIntervalMs: 0, ...maps }),
    ).rejects.toThrowError(RobotsBlockedError);
    expect(calls.some((c) => c.includes('/private/'))).toBe(false);
    const ok = await fetchPageText('https://x.example/public/page', {
      fetchImpl: stubFetch({ 'https://x.example/robots.txt': { body: robots }, 'https://x.example/public/page': { body: '<html><body>hi</body></html>' } }, []),
      minIntervalMs: 0,
      ...maps,
    });
    expect(ok.text).toContain('hi');
  });
});

describe('cache', () => {
  const html = '<html><head><title>T</title></head><body><p>deadline soon</p></body></html>';

  it('serves the second identical fetch from the 24h URL-hash cache', async () => {
    const calls: string[] = [];
    const routes = {
      'https://c.example/robots.txt': { status: 404, body: '' },
      'https://c.example/page': { body: html },
    };
    const opts = {
      fetchImpl: stubFetch(routes, calls),
      minIntervalMs: 0,
      cache: new Map(),
      robotsCache: new Map(),
      lastFetch: new Map(),
    };
    const first = await fetchPageText('https://c.example/page', opts);
    expect(first.fromCache).toBe(false);
    const second = await fetchPageText('https://c.example/page', opts);
    expect(second.fromCache).toBe(true);
    expect(second.text).toBe(first.text);
    expect(calls.filter((c) => c.endsWith('/page'))).toHaveLength(1);
  });

  it('refetches after the TTL expires', async () => {
    const calls: string[] = [];
    let now = 1_000_000;
    const routes = {
      'https://t.example/robots.txt': { status: 404, body: '' },
      'https://t.example/page': { body: html },
    };
    const opts = {
      fetchImpl: stubFetch(routes, calls),
      minIntervalMs: 0,
      now: () => now,
      cache: new Map(),
      robotsCache: new Map(),
      lastFetch: new Map(),
    };
    await fetchPageText('https://t.example/page', opts);
    now += FETCH_TTL_MS + 1;
    const again = await fetchPageText('https://t.example/page', opts);
    expect(again.fromCache).toBe(false);
    expect(calls.filter((c) => c.endsWith('/page'))).toHaveLength(2);
  });
});

describe('rate limit and timeout', () => {
  it('waits 1s per host between fetches', async () => {
    const sleeps: number[] = [];
    const routes = {
      'https://r.example/a': { body: '<html><body>a</body></html>' },
      'https://r.example/b': { body: '<html><body>b</body></html>' },
    };
    const opts = {
      fetchImpl: stubFetch(routes, []),
      minIntervalMs: 1000,
      now: () => 0,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
      cache: new Map(),
      robotsCache: new Map([['https://r.example', []]]),
      lastFetch: new Map(),
    };
    await fetchPageText('https://r.example/a', opts);
    await fetchPageText('https://r.example/b', opts);
    expect(sleeps).toEqual([1000]);
  });

  it('aborts a hanging fetch', async () => {
    const hanging = (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    await expect(
      fetchPageText('https://h.example/slow', {
        fetchImpl: hanging as typeof fetch,
        timeoutMs: 30,
        minIntervalMs: 0,
        cache: new Map(),
        robotsCache: new Map(),
        lastFetch: new Map(),
      }),
    ).rejects.toThrowError(FetchTimeoutError);
  });
});

describe('PDF routing', () => {
  it('throws PdfContentError for PDF responses', async () => {
    const fetchImpl = stubFetch(
      {
        'https://p.example/robots.txt': { status: 404, body: '' },
        'https://p.example/doc.pdf': { contentType: 'application/pdf', body: '%PDF-fake' },
      },
      [],
    );
    await expect(
      fetchPageText('https://p.example/doc.pdf', {
        fetchImpl,
        minIntervalMs: 0,
        cache: new Map(),
        robotsCache: new Map(),
        lastFetch: new Map(),
      }),
    ).rejects.toThrowError(PdfContentError);
  });
});
