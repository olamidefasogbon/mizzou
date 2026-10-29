import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { advance } from '../agent/advance.js';
import { FileRunStore } from '../agent/store.js';
import { newRun, type RunRecord } from '../agent/types.js';
import { BudgetExceededError } from '../meta/budget.js';
import { SAY_BUDGET_HIT, SAY_GOT_IT, SAY_ON_IT } from '../voice/index.js';
import type { Extraction } from '../schemas/extraction.js';
import { FinishSchema, createDeepScanStep, type ModelTransport } from './orchestrator.js';

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

interface ScriptTurn {
  calls?: Array<{ name: string; args: unknown }>;
  text?: string;
}

function scriptedModel(script: ScriptTurn[]): ModelTransport & { previousIds: Array<string | null>; inputs: unknown[] } {
  const previousIds: Array<string | null> = [];
  const inputs: unknown[] = [];
  let n = 0;
  const transport: ModelTransport & { previousIds: Array<string | null>; inputs: unknown[] } = Object.assign(
    async (args: { previousResponseId: string | null; input: unknown }) => {
      previousIds.push(args.previousResponseId);
      inputs.push(args.input);
      const turn = script[Math.min(n, script.length - 1)] as ScriptTurn;
      n += 1;
      return {
        responseId: `r${n}`,
        calls: (turn.calls ?? []).map((c, i) => ({ callId: `c${n}-${i}`, name: c.name, args: JSON.stringify(c.args) })),
        text: turn.text ?? '',
        model: 'muse-spark-1.3',
        inputTokens: 100 + n,
        outputTokens: 20,
        costUsd: 0.001,
      };
    },
    { previousIds, inputs },
  );
  return transport;
}

function sitePages() {
  return {
    [`${SITE}/`]: {
      title: 'Program',
      text: 'Main page. Deadline December 1.',
      links: [
        { href: '/faq/', text: 'Frequently asked questions' },
        { href: '/apply/', text: 'Apply now' },
        { href: 'https://off.example/faq', text: 'Off-site FAQ' },
      ],
    },
    [`${SITE}/faq/`]: { title: 'FAQ', text: 'FAQ page.', links: [] },
    [`${SITE}/apply/`]: { title: 'Apply', text: 'Apply page.', links: [] },
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
  return { outcome, turns };
}

describe('model-driven orchestrator', () => {
  it('reads what the model picks, then finishes on its finish call', async () => {
    const fetched: string[] = [];
    const model = scriptedModel([
      {
        calls: [
          { name: 'find_links', args: { page_url: `${SITE}/` } },
          { name: 'read_page', args: { url: `${SITE}/` } },
        ],
      },
      { calls: [{ name: 'read_page', args: { url: `${SITE}/faq/` } }] },
      { calls: [{ name: 'finish', args: { summary: 'Found the key dates.' } }] },
    ]);
    const run = fakeRun();
    const events: Array<{ label?: string }> = [];
    const step = createDeepScanStep({
      model,
      fetchPage: async (url) => {
        fetched.push(url);
        const pages = sitePages();
        const page = pages[url as keyof typeof pages];
        if (!page) throw new Error(`no stub for ${url}`);
        return page;
      },
      readPage: async ({ url }) => ({ extraction: makeExtraction(url, ['Main deadline']), costUsd: 0.01, usage: { model: 'muse-spark-1.3', inputTokens: 500, outputTokens: 50 } }),
    });
    const wrapped = async (r: RunRecord) => {
      const out = await step(r);
      for (const e of out.events) events.push(e as { label?: string });
      return out;
    };
    const { outcome } = await drive(run, wrapped);
    const finished = FinishSchema.parse(outcome.finished);
    expect(finished.pagesRead.map((p) => p.url)).toEqual([`${SITE}/`, `${SITE}/faq/`]);
    expect(finished.deadlinesFound).toBe(2);
    expect(finished.summary).toBe('Found the key dates.');
    expect(events[0]).toMatchObject({ label: SAY_ON_IT });
    expect(events[events.length - 1]).toMatchObject({ label: SAY_GOT_IT });
    // Per-turn usage ledger: orchestrator entries carry model + tokens.
    const orch = (run.state as { deepScan: { calls: Array<Record<string, unknown>> } }).deepScan.calls.filter((c) => c['role'] === 'orchestrator');
    expect(orch.length).toBeGreaterThan(0);
    expect(orch[0]).toMatchObject({ model: 'muse-spark-1.3' });
    expect(orch[0]['inputTokens']).toBeGreaterThan(0);
    const reader = (run.state as { deepScan: { calls: Array<Record<string, unknown>> } }).deepScan.calls.filter((c) => c['role'] === 'reader');
    expect(reader).toHaveLength(2);
    expect(reader[0]).toMatchObject({ tool: 'read_page', model: 'muse-spark-1.3' });
    expect(run.usageUsd).toBeCloseTo(3 * 0.001 + 2 * 0.01, 10);
    // Chained server-side history across turns.
    expect(model.previousIds[0]).toBeNull();
    expect(model.previousIds[1]).toBe('r1');
  });

  it('halts for a human on request_approval', async () => {
    const model = scriptedModel([{ calls: [{ name: 'request_approval', args: { gate: 'G1', what: 'Wrong program?' } }] }]);
    const run = fakeRun();
    const { outcome } = await drive(run, createDeepScanStep({ model }));
    expect(outcome.gate?.gate).toBe('G1');
    expect(outcome.finished).toBeUndefined();
  });

  it('halts for a human when no program is confirmed, without any model call', async () => {
    let modelCalls = 0;
    const model: ModelTransport = (async () => {
      modelCalls += 1;
      return { responseId: 'r', calls: [], text: '', model: 'm', inputTokens: 0, outputTokens: 0, costUsd: 0 };
    }) as ModelTransport;
    const run = newRun('ds2');
    const { outcome } = await drive(run, createDeepScanStep({ model }));
    expect(outcome.gate?.gate).toBe('G1');
    expect(modelCalls).toBe(0);
  });

  it('finishes with a budget note when the reader is blocked', async () => {
    const model = scriptedModel([{ calls: [{ name: 'read_page', args: { url: `${SITE}/` } }] }]);
    const run = fakeRun();
    const labels: string[] = [];
    const step = createDeepScanStep({
      model,
      fetchPage: async () => ({ title: 'P', text: 'text', links: [] }),
      readPage: async () => {
        throw new BudgetExceededError('user');
      },
    });
    const wrapped = async (r: RunRecord) => {
      const out = await step(r);
      for (const e of out.events) {
        if (e.t === 'status') labels.push((e as { label: string }).label);
      }
      return out;
    };
    const { outcome } = await drive(run, wrapped);
    const finished = (outcome.finished ?? {}) as { error?: unknown };
    expect(finished.error).toBe('budget hit');
    expect(labels).toContain(SAY_BUDGET_HIT);
  });

  it('ends the scan on empty prose instead of looping', async () => {
    const model = scriptedModel([{ text: '' }, { text: 'All set.' }]);
    const run = fakeRun();
    const { outcome, turns } = await drive(
      run,
      createDeepScanStep({
        model,
        fetchPage: async () => ({ title: 'P', text: 'text', links: [] }),
        readPage: async ({ url }) => ({ extraction: makeExtraction(url, []), costUsd: 0 }),
      }),
    );
    expect(outcome.finished).toBeDefined();
    expect(turns).toBeLessThanOrEqual(2);
  });

  it('refuses off-site reads in code, whatever the model asks', async () => {
    const fetched: string[] = [];
    const model = scriptedModel([
      { calls: [{ name: 'read_page', args: { url: 'https://off.example/faq' } }] },
      { calls: [{ name: 'finish', args: { summary: 'done' } }] },
    ]);
    const run = fakeRun();
    const { outcome } = await drive(
      run,
      createDeepScanStep({
        model,
        fetchPage: async (url) => {
          fetched.push(url);
          return { title: 'x', text: 'x', links: [] };
        },
        readPage: async ({ url }) => ({ extraction: makeExtraction(url, []), costUsd: 0 }),
      }),
    );
    expect(fetched).not.toContain('https://off.example/faq');
    expect(outcome.finished).toBeDefined();
  });

  it('caps depth and page budget in code', async () => {
    const model = scriptedModel([
      { calls: [{ name: 'find_links', args: { page_url: `${SITE}/` } }] },
      { calls: [{ name: 'read_page', args: { url: `${SITE}/deep/x` } }, { name: 'read_page', args: { url: `${SITE}/faq/` } }] },
      { calls: [{ name: 'finish', args: { summary: 'done' } }] },
    ]);
    const run = fakeRun();
    const step = createDeepScanStep({
      model,
      maxPages: 1,
      fetchPage: async (url) => {
        if (url === `${SITE}/`) return { title: 'P', text: 'Main page. Deadline December 1.', links: [{ href: '/deep/x', text: 'Deep' }, { href: '/faq/', text: 'FAQ' }] };
        return { title: url, text: 'text', links: [] };
      },
      readPage: async ({ url }) => ({ extraction: makeExtraction(url, []), costUsd: 0 }),
    });
    const mem = () => (run.state as { deepScan: { depths: Record<string, number>; pages: unknown[] } }).deepScan;
    await step(run);
    await step(run);
    // find_links assigned depth 1 to both; force one deeper to prove enforcement.
    mem().depths[`${SITE}/deep/x`] = 3;
    const { outcome } = await drive(run, step);
    const finished = FinishSchema.parse(outcome.finished);
    expect(finished.pagesRead.length).toBeLessThanOrEqual(1);
  });

  it('feeds code-ranked links into the next model turn', async () => {
    const model = scriptedModel([
      { calls: [{ name: 'find_links', args: { page_url: `${SITE}/` } }] },
      { calls: [{ name: 'finish', args: { summary: 'done' } }] },
    ]);
    const run = fakeRun();
    const step = createDeepScanStep({
      model,
      fetchPage: async (url) => {
        const pages = sitePages();
        return pages[url as keyof typeof pages] ?? { title: url, text: 'text', links: [] };
      },
      readPage: async ({ url }) => ({ extraction: makeExtraction(url, []), costUsd: 0 }),
    });
    await step(run);
    await step(run);
    const secondInput = JSON.stringify(model.inputs[1] ?? '');
    expect(secondInput).toContain(`${SITE}/faq/`);
    expect(secondInput).not.toContain('off.example');
  });

  it('runs inside advance() with a file store and says got-it at the end', async () => {
    const dir = await mkdtemp(join(HERE, '.tmp-orch-'));
    try {
      const store = new FileRunStore(dir);
      const run = fakeRun();
      run.id = 'ds-adv';
      await store.save(run);
      const model = scriptedModel([
        { calls: [{ name: 'read_page', args: { url: `${SITE}/` } }] },
        { calls: [{ name: 'finish', args: { summary: 'done' } }] },
      ]);
      const labels: string[] = [];
      const { needsResume } = await advance('ds-adv', store, createDeepScanStep({
        model,
        fetchPage: async () => ({ title: 'P', text: 'Main page. Deadline December 1.', links: [] }),
        readPage: async ({ url }) => ({ extraction: makeExtraction(url, ['Main deadline']), costUsd: 0.01 }),
      }), {
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
