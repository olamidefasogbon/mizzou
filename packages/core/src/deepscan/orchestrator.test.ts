import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { advance } from '../agent/advance.js';
import { FileRunStore } from '../agent/store.js';
import { newRun, type RunRecord } from '../agent/types.js';
import { BudgetExceededError } from '../meta/budget.js';
import { SAY_BUDGET_HIT, STATUS_DONE, STATUS_START } from '../voice/index.js';
import type { Extraction } from '../schemas/extraction.js';
import { FinishSchema, createDeepScanStep, type ModelTransport } from './orchestrator.js';
import type { JudgeTransport } from '../extract/reconcile.js';
import { BudgetGuard, InMemoryUsageStore } from '../meta/budget.js';

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
  // Unit runs simulate post-G1 scanning: the G1 decision is already in.
  // G1-turn tests below build their own runs without it.
  run.decisions.push({ gate: 'G1', decision: { confirmed: true }, opId: 'test-auto' });
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
    expect(events[0]).toMatchObject({ label: STATUS_START });
    expect(events[events.length - 1]).toMatchObject({ label: STATUS_DONE });
    // Per-turn usage ledger: orchestrator entries carry model + tokens.
    const orch = (run.state as { deepScan: { calls: Array<Record<string, unknown>> } }).deepScan.calls.filter((c) => c['role'] === 'orchestrator');
    expect(orch.length).toBeGreaterThan(0);
    expect(orch[0]).toMatchObject({ model: 'muse-spark-1.3' });
    expect(orch[0]['inputTokens']).toBeGreaterThan(0);
    const reader = (run.state as { deepScan: { calls: Array<Record<string, unknown>> } }).deepScan.calls.filter((c) => c['role'] === 'reader');
    expect(reader).toHaveLength(2);
    expect(reader[0]).toMatchObject({ tool: 'read_page', model: 'muse-spark-1.3' });
    expect(run.usageUsd).toBeCloseTo(3 * 0.001 + 2 * 0.01, 10);
    // The finish total includes every model call, not just the reader ones.
    expect(finished.usageUsd).toBeCloseTo(run.usageUsd, 10);
    // Stateless replay: no chaining, and later turns resend earlier context.
    expect(model.previousIds.every((id) => id === null)).toBe(true);
    const laterInputs = model.inputs.slice(1).map((i) => JSON.stringify(i));
    expect(laterInputs.some((s) => s.includes(`${SITE}/`))).toBe(true);
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

  it('halts at G2 with both sources when pages disagree and the judge cannot decide', async () => {
    const a = makeExtraction(`${SITE}/`, ['Main deadline']);
    const b = makeExtraction(`${SITE}/faq/`, ['Main deadline']);
    b.deadlines[0].field.value.iso_utc = '2026-12-15T00:00:00Z';
    b.deadlines[0].field.evidence_quote = 'December 15';
    const model = scriptedModel([
      { calls: [{ name: 'find_links', args: { page_url: `${SITE}/` } }, { name: 'read_page', args: { url: `${SITE}/` } }] },
      { calls: [{ name: 'read_page', args: { url: `${SITE}/faq/` } }] },
      { calls: [{ name: 'finish', args: { summary: 'done' } }] },
    ]);
    const judge: JudgeTransport = async () => ({
      verdict: { resolutions: [{ field: 'deadlines:Main deadline', chosen_iso: null, reason: 'Neither source clearly wins.' }] },
      costUsd: 0.02,
    });
    const run = fakeRun();
    const step = createDeepScanStep({
      model,
      judge,
      fetchPage: async (url) => (url === `${SITE}/`
        ? { title: 'Program', text: 'Main page. Deadline December 1.', links: [{ href: '/faq/', text: 'FAQ' }] }
        : { title: url, text: 'text', links: [] }),
      readPage: async ({ url }) => ({ extraction: url === `${SITE}/` ? a : b, costUsd: 0 }),
    });
    const { outcome } = await drive(run, step);
    expect(outcome.gate?.gate).toBe('G2');
    expect(outcome.finished).toBeUndefined();
    const evidence = outcome.gate?.evidence as { conflicts: Array<{ field: string; values: Array<{ source_url: string }> }> };
    expect(evidence.conflicts).toHaveLength(1);
    expect(evidence.conflicts[0].values.map((v) => v.source_url).sort()).toEqual([`${SITE}/`, `${SITE}/faq/`]);
    const mem = run.state as { deepScan: { reconciled: Extraction | null } };
    expect(mem.deepScan.reconciled?.deadlines.every((d) => d.field.needs_human)).toBe(true);
  });

  it('finishes after the human answers G2, without re-asking', async () => {
    const a = makeExtraction(`${SITE}/`, ['Main deadline']);
    const b = makeExtraction(`${SITE}/faq/`, ['Main deadline']);
    b.deadlines[0].field.value.iso_utc = '2026-12-15T00:00:00Z';
    const model = scriptedModel([
      { calls: [{ name: 'find_links', args: { page_url: `${SITE}/` } }, { name: 'read_page', args: { url: `${SITE}/` } }] },
      { calls: [{ name: 'read_page', args: { url: `${SITE}/faq/` } }] },
      { calls: [{ name: 'finish', args: { summary: 'done' } }] },
    ]);
    const judge: JudgeTransport = async () => ({
      verdict: { resolutions: [{ field: 'deadlines:Main deadline', chosen_iso: null, reason: 'Tie.' }] },
      costUsd: 0,
    });
    const run = fakeRun();
    const step = createDeepScanStep({
      model,
      judge,
      fetchPage: async (url) => (url === `${SITE}/`
        ? { title: 'Program', text: 'Main page. Deadline December 1.', links: [{ href: '/faq/', text: 'FAQ' }] }
        : { title: url, text: 'text', links: [] }),
      readPage: async ({ url }) => ({ extraction: url === `${SITE}/` ? a : b, costUsd: 0 }),
    });
    const first = await drive(run, step);
    expect(first.outcome.gate?.gate).toBe('G2');
    // Human answers (same shape recordDecision writes): next step must finish.
    run.decisions.push({ gate: 'G2', decision: 'December 1 looks right', opId: 'op-1' });
    run.pendingGate = null;
    run.status = 'running';
    const second = await drive(run, step);
    expect(second.outcome.finished).toBeDefined();
    expect(second.outcome.gate).toBeUndefined();
    const finished = FinishSchema.parse(second.outcome.finished);
    expect(finished.extraction?.deadlines.length).toBeGreaterThan(0);
  });

  it('lets the judge resolve a conflict and emits a coverage card', async () => {
    const a = makeExtraction(`${SITE}/`, ['Main deadline']);
    const b = makeExtraction(`${SITE}/faq/`, ['Main deadline']);
    b.deadlines[0].field.value.iso_utc = '2026-12-15T00:00:00Z';
    const model = scriptedModel([
      { calls: [{ name: 'find_links', args: { page_url: `${SITE}/` } }, { name: 'read_page', args: { url: `${SITE}/` } }] },
      { calls: [{ name: 'read_page', args: { url: `${SITE}/faq/` } }] },
      { calls: [{ name: 'finish', args: { summary: 'done' } }] },
    ]);
    const judge: JudgeTransport = async () => ({
      verdict: { resolutions: [{ field: 'deadlines:Main deadline', chosen_iso: '2026-12-01T00:00:00Z', reason: 'Program page governs.' }] },
      costUsd: 0.02,
      model: 'muse-spark-1.3',
      inputTokens: 400,
      outputTokens: 30,
    });
    const run = fakeRun();
    const cardKinds: string[] = [];
    const step = createDeepScanStep({
      model,
      judge,
      fetchPage: async (url) => (url === `${SITE}/`
        ? { title: 'Program', text: 'Main page. Deadline December 1.', links: [{ href: '/faq/', text: 'FAQ' }] }
        : { title: url, text: 'text', links: [] }),
      readPage: async ({ url }) => ({ extraction: url === `${SITE}/` ? a : b, costUsd: 0 }),
    });
    const wrapped = async (r: RunRecord) => {
      const out = await step(r);
      for (const e of out.events) if (e.t === 'card') cardKinds.push((e as { kind: string }).kind);
      return out;
    };
    const { outcome } = await drive(run, wrapped);
    expect(outcome.gate).toBeUndefined();
    const finished = FinishSchema.parse(outcome.finished);
    expect(finished.conflicts).toEqual([]);
    expect(finished.extraction?.deadlines).toHaveLength(1);
    expect(finished.extraction?.deadlines[0].field.needs_human).toBe(false);
    expect(cardKinds).toContain('coverage');
    const calls = (run.state as { deepScan: { calls: Array<{ role: string | null }> } }).deepScan.calls;
    expect(calls.some((c) => c.role === 'judge')).toBe(true);
  });

  it('asks G1 natively on first contact, counting the program page as page 1', async () => {
    let modelCalls = 0;
    const model = (async () => {
      modelCalls += 1;
      return { responseId: 'r', calls: [], text: '', model: 'm', inputTokens: 0, outputTokens: 0, costUsd: 0 };
    }) as ModelTransport;
    const run = newRun('ds-g1', 'u1', 'c1');
    run.state = { programUrl: `${SITE}/`, programHint: 'Scholars' };
    const step = createDeepScanStep({
      model,
      fetchPage: async () => ({ title: 'Program', text: 'Main page. Deadline December 1.', links: [] }),
      readPage: async ({ url }) => ({ extraction: makeExtraction(url, ['Main deadline']), costUsd: 0.01 }),
    });
    const outcome = await step(run);
    expect(modelCalls).toBe(0);
    expect(outcome.gate?.gate).toBe('G1');
    const card = (outcome.gate?.evidence as { card: { kind: string; source_url: string } }).card;
    expect(card.kind).toBe('program');
    expect(card.source_url).toBe(`${SITE}/`);
    const mem = run.state as { deepScan: { pages: unknown[]; g1Asked: boolean } };
    expect(mem.deepScan.pages).toHaveLength(1);
    expect(mem.deepScan.g1Asked).toBe(true);
  });

  it('ends the G1 turn with an error when the program page will not open', async () => {
    const model = scriptedModel([{ text: 'unused' }]);
    const run = newRun('ds-g1-err', 'u1', 'c1');
    run.state = { programUrl: `${SITE}/` };
    const step = createDeepScanStep({
      model,
      fetchPage: async () => {
        throw new Error('blocked');
      },
    });
    const outcome = await step(run);
    expect(outcome.gate).toBeUndefined();
    expect(outcome.finished).toBeDefined();
    expect((outcome.finished as { error?: string }).error).toContain('blocked');
  });

  it('scans after a G1 yes and stops quietly on a G1 no', async () => {
    const build = (id: string) => {
      const run = newRun(id, 'u1', 'c1');
      run.state = { programUrl: `${SITE}/`, programHint: 'Scholars' };
      return run;
    };
    const scanning = (model: ModelTransport) =>
      createDeepScanStep({
        model,
        fetchPage: async (url) => (url === `${SITE}/`
          ? { title: 'Program', text: 'Main page.', links: [{ href: '/faq/', text: 'FAQ' }] }
          : { title: url, text: 'text', links: [] }),
        readPage: async ({ url }) => ({ extraction: makeExtraction(url, ['Main deadline']), costUsd: 0 }),
      });
    // Yes: G1 turn first, then the scan proceeds on the resumed pass.
    const yesRun = build('ds-g1-yes');
    const yesModel = scriptedModel([
      { calls: [{ name: 'find_links', args: { page_url: `${SITE}/` } }] },
      { calls: [{ name: 'finish', args: { summary: 'done' } }] },
    ]);
    const first = await scanning(yesModel)(yesRun);
    expect(first.gate?.gate).toBe('G1');
    yesRun.decisions.push({ gate: 'G1', decision: { confirmed: true }, opId: 'op-yes' });
    yesRun.pendingGate = null;
    yesRun.status = 'running';
    const { outcome: yesOutcome } = await drive(yesRun, scanning(yesModel));
    expect(yesOutcome.finished).toBeDefined();
    // No: the run ends without scanning further.
    let modelCalls = 0;
    const noModel = (async () => {
      modelCalls += 1;
      return { responseId: 'r', calls: [], text: '', model: 'm', inputTokens: 0, outputTokens: 0, costUsd: 0 };
    }) as ModelTransport;
    const noRun = build('ds-g1-no');
    const noStep = scanning(noModel);
    const gated = await noStep(noRun);
    expect(gated.gate?.gate).toBe('G1');
    noRun.decisions.push({ gate: 'G1', decision: { confirmed: false }, opId: 'op-no' });
    noRun.pendingGate = null;
    noRun.status = 'running';
    const refused = await noStep(noRun);
    expect(modelCalls).toBe(0);
    expect(refused.finished).toBeDefined();
    expect((refused.finished as { error?: string }).error).toBe('program not confirmed');
  });

  it('merges the chat quick extraction instead of re-reading the program page', async () => {
    const run = fakeRun();
    run.state = {
      programUrl: `${SITE}/`,
      programHint: 'Scholars',
      quickTitle: 'Program',
      quickExtraction: makeExtraction(`${SITE}/`, ['Main deadline']),
    };
    let reads = 0;
    const model = scriptedModel([
      { calls: [{ name: 'find_links', args: { page_url: `${SITE}/` } }] },
      { calls: [{ name: 'finish', args: { summary: 'done' } }] },
    ]);
    const step = createDeepScanStep({
      model,
      fetchPage: async (url) => (url === `${SITE}/`
        ? { title: 'Program', text: 'Main page.', links: [{ href: '/faq/', text: 'FAQ' }] }
        : { title: url, text: 'text', links: [] }),
      readPage: async ({ url }) => {
        reads += 1;
        return { extraction: makeExtraction(url, []), costUsd: 0 };
      },
    });
    const { outcome } = await drive(run, step);
    expect(reads).toBe(0);
    const finished = FinishSchema.parse(outcome.finished);
    expect(finished.extraction?.deadlines).toHaveLength(1);
  });

  it('keeps the guard ledger equal to the run ledger across reader, orchestrator and judge', async () => {
    // Stubs record through the guard exactly like the production transports
    // do (check, then recordCall); the step must report every reported cost.
    const guard = new BudgetGuard(new InMemoryUsageStore(), {
      perUserDailyUsd: 10,
      globalDailyUsd: 100,
    });
    const record = (userId: string, promptTokens: number, outputTokens: number): number =>
      guard.recordCall({ userId, model: 'muse-spark-1.3', promptTokens, completionTokens: outputTokens });
    const a = makeExtraction(`${SITE}/`, ['Main deadline']);
    const b = makeExtraction(`${SITE}/faq/`, ['Main deadline']);
    b.deadlines[0].field.value.iso_utc = '2026-12-15T00:00:00Z';
    const scripted = scriptedModel([
      { calls: [{ name: 'find_links', args: { page_url: `${SITE}/` } }, { name: 'read_page', args: { url: `${SITE}/` } }] },
      { calls: [{ name: 'read_page', args: { url: `${SITE}/faq/` } }] },
      { calls: [{ name: 'finish', args: { summary: 'done' } }] },
    ]);
    const taggedModel: ModelTransport = (async (args: { userId?: string; previousResponseId?: string | null; input?: unknown; turn: number }) => {
      const cost = record(args.userId ?? 'u1', 100, 20);
      const out = await scripted({
        systemPrompt: '',
        input: args.input ?? null,
        tools: [],
        previousResponseId: args.previousResponseId ?? null,
        turn: args.turn,
      });
      return { ...out, costUsd: cost };
    }) as ModelTransport;
    const judge: JudgeTransport = async ({ userId }) => {
      const cost = record(userId ?? 'u1', 200, 10);
      return {
        verdict: { resolutions: [{ field: 'deadlines:Main deadline', chosen_iso: '2026-12-01T00:00:00Z', reason: 'Program page governs.' }] },
        costUsd: cost,
      };
    };
    const run = fakeRun();
    const step = createDeepScanStep({
      model: taggedModel,
      judge,
      fetchPage: async (url) => (url === `${SITE}/`
        ? { title: 'Program', text: 'Main page.', links: [{ href: '/faq/', text: 'FAQ' }] }
        : { title: url, text: 'text', links: [] }),
      readPage: async ({ url }, ctx) => {
        const cost = record(ctx.userId ?? 'u1', 500, 100);
        return { extraction: url === `${SITE}/` ? a : b, costUsd: cost };
      },
    });
    const { outcome } = await drive(run, step);
    const finished = FinishSchema.parse(outcome.finished);
    const ledgerSum = finished.usage.reduce((n, u) => n + u.costUsd, 0);
    expect(finished.usageUsd).toBeCloseTo(ledgerSum, 10);
    // The guard counted the orchestrator turns, the reader calls and the
    // judge — the same total the run reports.
    expect(guard.spendToday('u1')).toBeCloseTo(ledgerSum, 10);
    expect(finished.usage.some((u) => u.role === 'judge')).toBe(true);
  });

  it('retries a flaky model call twice, then records the last error', async () => {
    const slept: number[] = [];
    let calls = 0;
    const model = (async () => {
      calls += 1;
      if (calls <= 2) throw new Error('flaky transport');
      return { responseId: 'r3', calls: [], text: 'All set.', model: 'm', inputTokens: 1, outputTokens: 1, costUsd: 0 };
    }) as ModelTransport;
    const run = fakeRun();
    const step = createDeepScanStep({
      model,
      sleepMs: async (ms: number) => {
        slept.push(ms);
      },
      fetchPage: async () => ({ title: 'P', text: 'text', links: [] }),
      readPage: async ({ url }) => ({ extraction: makeExtraction(url, []), costUsd: 0 }),
    });
    const { outcome } = await drive(run, step);
    expect(outcome.finished).toBeDefined();
    expect(calls).toBe(3);
    expect(slept).toEqual([500, 1000]);
    const mem = run.state as { deepScan: { errors: number; lastError: string | null } };
    expect(mem.deepScan.errors).toBe(0);
    expect(mem.deepScan.lastError).toBeNull();
  });

  it('gives up after the retries and never retries a budget halt', async () => {
    const slept: number[] = [];
    let calls = 0;
    const model = (async () => {
      calls += 1;
      throw new Error('down');
    }) as ModelTransport;
    const run = fakeRun();
    const step = createDeepScanStep({
      model,
      sleepMs: async (ms: number) => {
        slept.push(ms);
      },
      fetchPage: async () => ({ title: 'P', text: 'text', links: [] }),
      readPage: async ({ url }) => ({ extraction: makeExtraction(url, []), costUsd: 0 }),
    });
    const { outcome } = await drive(run, step);
    expect(calls).toBe(9);
    expect(slept).toEqual([500, 1000, 500, 1000, 500, 1000]);
    expect((outcome.finished as { error?: string }).error).toContain('orchestrator unreachable (down)');
    const mem = run.state as { deepScan: { lastError: string | null } };
    expect(mem.deepScan.lastError).toBe('down');

    let budgetCalls = 0;
    const budgetModel = (async () => {
      budgetCalls += 1;
      throw new BudgetExceededError('user');
    }) as ModelTransport;
    const budgetRun = fakeRun();
    const budgetStep = createDeepScanStep({
      model: budgetModel,
      fetchPage: async () => ({ title: 'P', text: 'text', links: [] }),
      readPage: async ({ url }) => ({ extraction: makeExtraction(url, []), costUsd: 0 }),
    });
    const { outcome: budgetOutcome } = await drive(budgetRun, budgetStep);
    expect(budgetCalls).toBe(1);
    expect((budgetOutcome.finished as { error?: string }).error).toBe('budget hit');
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
      expect(labels[0]).toBe(STATUS_START);
      expect(labels[labels.length - 1]).toBe(STATUS_DONE);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
