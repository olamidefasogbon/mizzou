// Parallel fetch with robots.txt, rate limits and a 24h URL-hash cache
// (PROMPT.md tool table: fetch_page). No model calls here.
// Readability needs a DOM, which is unavailable in this runtime, so text
// extraction is cheerio-only: scripts, styles and chrome removed, article
// or main preferred, whitespace collapsed.

import { createHash } from 'node:crypto';
import { load } from 'cheerio';

export interface OutboundLink {
  href: string;
  text: string;
}

export interface CleanPage {
  title: string;
  text: string;
  links: OutboundLink[];
}

export interface FetchPageResult extends CleanPage {
  url: string;
  fromCache: boolean;
}

export class RobotsBlockedError extends Error {
  readonly url: string;
  constructor(url: string) {
    super(`Blocked by robots.txt: ${url}`);
    this.name = 'RobotsBlockedError';
    this.url = url;
  }
}

export class PdfContentError extends Error {
  readonly url: string;
  constructor(url: string) {
    super(`PDF content, route to read_pdf: ${url}`);
    this.name = 'PdfContentError';
    this.url = url;
  }
}

export class FetchTimeoutError extends Error {
  readonly url: string;
  constructor(url: string) {
    super(`Fetch timed out: ${url}`);
    this.name = 'FetchTimeoutError';
    this.url = url;
  }
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Collapse each page's links for find_links. Resolves relatives, keeps text. */
export function extractLinks(html: string, baseUrl: string): OutboundLink[] {
  const $ = load(html);
  const links: OutboundLink[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const url = new URL(href, baseUrl).toString();
      if (!url.startsWith('http://') && !url.startsWith('https://')) return;
      links.push({ href: url, text: $(el).text().trim().replace(/\s+/g, ' ').slice(0, 120) });
    } catch {
      // Ignore unparseable hrefs; ranking drops them too.
    }
  });
  return links;
}

/** Cheerio-only main-content text: chrome removed, article/main preferred. */
export function cleanPageText(html: string): { title: string; text: string } {
  const $ = load(html);
  const title = $('title').first().text().trim().replace(/\s+/g, ' ');
  $('script, style, noscript, nav, header, footer, svg, form').remove();
  const main = $('article, main, [role="main"]').first();
  // Cheerio<Element> only: fragments without a body yield empty text.
  const scope = main.length > 0 ? main : $('body');
  const text =
    scope.length > 0
      ? scope
          .text()
          .split('\n')
          .map((line) => line.replace(/[ \t]+/g, ' ').trim())
          .filter((line) => line.length > 0)
          .join('\n')
      : '';
  return { title, text };
}

interface RobotsGroup {
  agents: string[];
  disallows: string[];
}

/** Minimal robots.txt parser: user-agent groups with Disallow lines. */
export function parseRobots(txt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  for (const rawLine of txt.split('\n')) {
    const line = rawLine.split('#')[0].trim();
    if (line.length === 0) continue;
    const [field, ...rest] = line.split(':');
    const value = rest.join(':').trim();
    const name = field.trim().toLowerCase();
    if (name === 'user-agent') {
      if (!current || current.disallows.length > 0) {
        current = { agents: [], disallows: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (name === 'disallow' && current) {
      current.disallows.push(value);
    }
  }
  return groups;
}

/** True when path may be fetched: an empty Disallow allows all; any
 *  non-empty prefix match in our group (exact UA or *) blocks. */
export function isAllowed(groups: RobotsGroup[], userAgent: string, path: string): boolean {
  const ua = userAgent.toLowerCase();
  const matching = groups.filter((g) => g.agents.some((a) => a === '*' || ua.includes(a) || a.includes(ua)));
  if (matching.length === 0) return true;
  const disallows = matching.flatMap((g) => g.disallows);
  if (disallows.some((d) => d === '')) return true;
  const queryless = path.split('?')[0];
  return !disallows.some((d) => d !== '' && queryless.startsWith(d));
}

export interface FetchDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  cache?: Map<string, { at: number; value: FetchPageResult | FetchedBytes }>;
  robotsCache?: Map<string, RobotsGroup[]>;
  lastFetch?: Map<string, number>;
  minIntervalMs?: number;
  timeoutMs?: number;
  userAgent?: string;
}

export interface FetchedBytes {
  url: string;
  bytes: Uint8Array;
  contentType: string | null;
  fromCache: boolean;
}

export const FETCH_TTL_MS = 24 * 3600 * 1000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MIN_INTERVAL_MS = 1000;
const DEFAULT_UA = 'Mozilla/5.0 Mizzou-deep-scan';

function originOf(url: string): string {
  return new URL(url).origin;
}

async function politeWait(origin: string, deps: Required<Pick<FetchDeps, 'now' | 'sleep' | 'lastFetch' | 'minIntervalMs'>>): Promise<void> {
  const last = deps.lastFetch.get(origin) ?? -Infinity;
  const wait = deps.minIntervalMs - (deps.now() - last);
  if (wait > 0) await deps.sleep(wait);
  deps.lastFetch.set(origin, deps.now());
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') throw new FetchTimeoutError(url);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function robotsFor(
  origin: string,
  deps: Required<Pick<FetchDeps, 'fetchImpl' | 'now' | 'sleep' | 'robotsCache' | 'lastFetch' | 'minIntervalMs' | 'timeoutMs' | 'userAgent'>>,
): Promise<RobotsGroup[]> {
  const cached = deps.robotsCache.get(origin);
  if (cached) return cached;
  await politeWait(origin, deps);
  try {
    const res = await fetchWithTimeout(deps.fetchImpl, `${origin}/robots.txt`, deps.timeoutMs, {
      headers: { 'User-Agent': deps.userAgent },
    });
    const groups = res.ok ? parseRobots(await res.text()) : [];
    deps.robotsCache.set(origin, groups);
    return groups;
  } catch {
    deps.robotsCache.set(origin, []);
    return [];
  }
}

async function guardedFetch(
  url: string,
  deps: Required<FetchDeps>,
): Promise<Response> {
  const origin = originOf(url);
  const path = new URL(url).pathname || '/';
  const rules = await robotsFor(origin, deps);
  if (!isAllowed(rules, deps.userAgent, path)) throw new RobotsBlockedError(url);
  await politeWait(origin, deps);
  return fetchWithTimeout(deps.fetchImpl, url, deps.timeoutMs, { headers: { 'User-Agent': deps.userAgent } });
}

/**
 * Process-wide defaults so the 24h URL-hash cache, robots rules and per-host
 * rate limits hold across calls without the caller threading maps through.
 * Tests inject their own maps for isolation.
 */
const sharedCache = new Map<string, { at: number; value: FetchPageResult | FetchedBytes }>();
const sharedRobots = new Map<string, RobotsGroup[]>();
const sharedLastFetch = new Map<string, number>();

function fullDeps(deps: FetchDeps): Required<FetchDeps> {
  return {
    fetchImpl: deps.fetchImpl ?? fetch,
    now: deps.now ?? Date.now,
    sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    cache: deps.cache ?? sharedCache,
    robotsCache: deps.robotsCache ?? sharedRobots,
    lastFetch: deps.lastFetch ?? sharedLastFetch,
    minIntervalMs: deps.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS,
    timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    userAgent: deps.userAgent ?? DEFAULT_UA,
  };
}

/**
 * fetch_page: plain fetch with robots.txt, 10s timeout and 1 req/s per
 * host. Cached by URL hash for 24h. PDF content throws PdfContentError so
 * the orchestrator can route it to read_pdf.
 */
export async function fetchPageText(url: string, deps: FetchDeps = {}): Promise<FetchPageResult> {
  const full = fullDeps(deps);
  const key = sha256Hex(url);
  const hit = full.cache.get(key);
  if (hit && full.now() - hit.at < FETCH_TTL_MS && 'text' in hit.value) {
    return { ...(hit.value as FetchPageResult), fromCache: true };
  }
  const res = await guardedFetch(url, full);
  if (!res.ok) throw new Error(`fetch ${url} -> HTTP ${res.status}`);
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('pdf') || new URL(url).pathname.toLowerCase().endsWith('.pdf')) {
    throw new PdfContentError(url);
  }
  const html = await res.text();
  const { title, text } = cleanPageText(html);
  const links = extractLinks(html, url);
  const result: FetchPageResult = { url, title, text, links, fromCache: false };
  full.cache.set(key, { at: full.now(), value: result });
  return result;
}

/** Raw bytes for read_pdf, under the same robots, rate-limit and cache rules. */
export async function fetchBytes(url: string, deps: FetchDeps = {}): Promise<FetchedBytes> {
  const full = fullDeps(deps);
  const key = `bytes:${sha256Hex(url)}`;
  const hit = full.cache.get(key);
  if (hit && full.now() - hit.at < FETCH_TTL_MS && 'bytes' in hit.value) {
    return { ...(hit.value as FetchedBytes), fromCache: true };
  }
  const res = await guardedFetch(url, full);
  if (!res.ok) throw new Error(`fetch ${url} -> HTTP ${res.status}`);
  const result: FetchedBytes = {
    url,
    bytes: new Uint8Array(await res.arrayBuffer()),
    contentType: res.headers.get('content-type'),
    fromCache: false,
  };
  full.cache.set(key, { at: full.now(), value: result });
  return result;
}
