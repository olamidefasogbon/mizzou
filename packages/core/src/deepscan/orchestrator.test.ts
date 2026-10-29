import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { advance } from '../agent/advance.js';
import { FileRunStore } from '../agent/store.js';
import { newRun, type RunRecord } from '../agent/types.js';
import { BudgetExceededError } from '../meta/budget.js';
import { SAY_BUDGET_HIT, SAY_GOT_IT, SAY_ON_IT } from '../voice/index.js';
import type { Extraction } from '../schemas/extraction.js';
import { FinishSchema, createDeepScanStep } from './orchestrator.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function evStr(value: string, url: string) {
  return { value, evidence_quote: value, source_url: url, confidence: 'high' as const, needs_human: false, checked: true };
}

function makeExtraction(url: string, deadlineLabels: string[]): Extraction {
  return {
    opportunity_type: 'academic_program',
    program: {
      name: evStr('Program', url),
      unit: evStr('Unit', url),
      institution: evStr('Inst', url),
      portal_url: null,
      language_read: 'en',
    },
    opens: null,
    deadlines: deadlineLabels.map((label) => ({
      label,
      field: {
        value: { iso_utc: '2026-12-01T00:00:00Z', original_tz: null, all_day: true, rolling: false },
        evidence_quote: 'December 1',
        source_url: url,
        confidence: 'high' as const,
        needs_human: false,
        checked: true,
      },
    })),
    documents: [],
    eligibility: [],
    people: [],
    tests: [],
    money: [],
    unusual_rules: [],
  };
}

const SITE = 'https://scan.example';

function siteTools(extractions: Record<string, Extraction>, unreadable: string[] = []) {
  const fetched: string[] = [];
  const pages: Record<string, { title: string; text: string; links: Array<{ href: string; text: string }> }> = {
    [`${SITE}/`]: {
      title: 'Program',
      text: 'Main page. Deadline December 1.',
      links: [
        { href: '/faq/', text: 'Frequently asked questions' },
        { href: '/apply/', text: 'Apply now' },
        { href: 'https://off.example/faq', text: 'Off-site FAQ' },
      ],
    },
    [`${SITE}/faq/`]: {
      title: 'FAQ',
      text: 'FAQ page.',
      links: [
        { href: '/faq/detail/', text: 'More FAQ detail' },
        { href: '/faq/deep/', text: 'Deep page' },
      ],
    },
    [`${SITE}/faq/detail/`]: { title: 'Detail', text: 'Detail page.', links: [] },
    [`${SITE}/faq/deep/`]: { title: 'Deep', text: 'Deep page.', links: [{ href: '/faq/too-far/', text: 'Too far' }] },
    [`${SITE}/apply/`]: { title: 'Apply', text: 'Apply page.', links: [] },
  };
  return {
    fetched,
    fetchPage: async (url: string) => {
      fetched.push(url);
      if (unreadable.includes(url)) throw new Error('blocked');
      const page = pages[url];
      if (!page) throw new Error(`no stub for ${url}`);
      return page;
    },
    readPage: async ({ url }: { url: string }) => ({
      extraction: extractions[url] ?? makeExtraction(url, []),
      costUsd: 0.01,
    }),
  };
}

function fakeRun(): RunRecord {
  const run = newRun('ds1', 'u1', 'c1');
  run.state = { programUrl: `${SITE}/`, programHint: 'Scholars' };
  return run;
}

async function drive(run: RunRecord, step: ReturnType<typeof createDeepScanStep>, limit = 40) {
  let outcome = await step(run);
  let turns = 1;
  while (outcome.finished === undefined && outcome.gate === undefined && turns < limit) {
    outcome = await step(run);
    turns += 1;
  }
  return outcome;
}

describe('deep-scan orchestrator', () => {
  it('reads the program page, follows ranked same-site links, then finishes', async () => {
    const tools = siteTools({ [`${SITE}/`]: makeExtraction(`${SITE}/`, ['Main deadline']) });
    const events: unknown[] = [];
    const step = createDeepScanStep(tools);
    const run = fakeRun();
    const wrapped = async (r: RunRecord) => {
      const out = await step(r);
      for (const e of out.events) events.push(e);
      return out;
    };
    const outcome = await drive(run, wrapped);
    expect(outcome.finished).toBeDefined();
    const finished = FinishSchema.parse(outcome.finished);
    expect(finished.pagesRead.map((p) => p.url)).toContain(`${SITE}/faq/`);
    expect(finished.pagesRead.map((p) => p.url)).toContain(`${SITE}/apply/`);
    expect(finished.deadlinesFound).toBe(1);
    expect(finished.usageUsd).toBeCloseTo(0.01 * finished.pagesRead.length, 10);
    expect((events as Array<{ label?: string }>)[0]).toMatchObject({ label: SAY_ON_IT });
    expect(run.usageUsd).toBeCloseTo(finished.usageUsd, 10);
  });

  it('never leaves the site and never descends past depth 2', async () => {
    const tools = siteTools({});
    const run = fakeRun();
    await drive(run, createDeepScanStep(tools));
    expect(tools.fetched).not.toContain('https://off.example/faq');
    expect(tools.fetched).not.toContain(`${SITE}/faq/too-far/`);
    expect(tools.fetched).toContain(`${SITE}/faq/deep/`);
  });

  it('caps the scan at the page budget', async () => {
    const manyLinks = Array.from({ length: 30 }, (_, i) => ({ href: `/p${i}/`, text: `FAQ page ${i}` }));
    const fetchPage = async (url: string) => ({ title: url, text: 'text', links: url === `${SITE}/` ? manyLinks : [] });
    const run = fakeRun();
    const outcome = await drive(run, createDeepScanStep({ fetchPage, readPage: async () => ({ extraction: makeExtraction(`${SITE}/`, []), costUsd: 0 }), maxPages: 5 }));
    const finished = FinishSchema.parse(outcome.finished);
    expect(finished.pagesRead.length).toBeLessThanOrEqual(5);
  });

  it('records unreadable pages and keeps scanning', async () => {
    const tools = siteTools({}, [`${SITE}/faq/`]);
    const run = fakeRun();
    const outcome = await drive(run, createDeepScanStep(tools));
    const finished = FinishSchema.parse(outcome.finished);
    expect(finished.unreadable.map((u) => u.url)).toContain(`${SITE}/faq/`);
    expect(finished.pagesRead.map((p) => p.url)).toContain(`${SITE}/apply/`);
  });

  it('halts for a human when no program is confirmed', async () => {
    const run = newRun('ds2');
    const outcome = await createDeepScanStep({})(run);
    expect(outcome.gate?.gate).toBe('G1');
    expect(outcome.finished).toBeUndefined();
  });

  it('finishes with a budget note when the reader is blocked', async () => {
    const tools = siteTools({});
    const run = fakeRun();
    const outcome = await drive(
      run,
      createDeepScanStep({
        ...tools,
        readPage: async () => {
          throw new BudgetExceededError('user');
        },
      }),
    );
    const finished = (outcome.finished ?? {}) as { error?: unknown };
    expect(finished.error).toBe('budget hit');
  });

  it('emits the budget-hit status line on a blocked reader', async () => {
    const tools = siteTools({});
    const events: Array<{ label?: string }> = [];
    const run = fakeRun();
    const step = createDeepScanStep({
      ...tools,
      readPage: async () => {
        throw new BudgetExceededError('user');
      },
    });
    const wrapped = async (r: RunRecord) => {
      const out = await step(r);
      for (const e of out.events) events.push(e as { label?: string });
      return out;
    };
    await drive(run, wrapped);
    expect(events.map((e) => e.label)).toContain(SAY_BUDGET_HIT);
  });

  it('reads a saved fixture page end to end in code', async () => {
    const html = readFileSync(join(HERE, '..', '..', '..', 'eval', 'fixtures', 'case-03.html'), 'utf-8');
    const { extractLinks, cleanPageText } = await import('./fetch.js');
    const { title, text } = cleanPageText(html);
    const links = extractLinks(html, 'https://eee.epfl.ch/');
    const run = fakeRun();
    run.state = { programUrl: 'https://eee.epfl.ch/', programHint: 'Excellence in Engineering' };
    const outcome = await drive(
      run,
      createDeepScanStep({
        fetchPage: async () => ({ title, text, links: links.map((l) => ({ href: l.href, text: l.text })) }),
        readPage: async () => ({ extraction: makeExtraction('https://eee.epfl.ch/', ['E3 deadline']), costUsd: 0 }),
      }),
    );
    const finished = FinishSchema.parse(outcome.finished);
    expect(finished.pagesRead.length).toBeGreaterThan(0);
    // The stub returns one deadline per page it reads.
    expect(finished.deadlinesFound).toBe(finished.pagesRead.length);
  });

  it('runs inside advance() with a file store and says got-it at the end', async () => {
    const dir = await mkdtemp(join(HERE, '.tmp-orch-'));
    try {
      const store = new FileRunStore(dir);
      const run = fakeRun();
      run.id = 'ds-adv';
      await store.save(run);
      const tools = siteTools({ [`${SITE}/`]: makeExtraction(`${SITE}/`, ['Main deadline']) });
      const labels: string[] = [];
      const { needsResume } = await advance('ds-adv', store, createDeepScanStep(tools), {
        maxTurns: 12,
        onEvent: (e) => {
          if (e.t === 'status') labels.push(e.label);
        },
      });
      expect(needsResume).toBe(false);
      const done = await store.load('ds-adv');
      expect(done?.status).toBe('done');
      expect(labels[0]).toBe(SAY_ON_IT);
      expect(labels[labels.length - 1]).toBe(SAY_GOT_IT);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
