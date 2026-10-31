import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { newRun, type RunRecord } from '../agent/types.js';
import type { RunEvent } from '../schemas/events.js';
import type { Extraction } from '../schemas/extraction.js';
import type { ResponsesCallResult, StreamCallOptions } from '../meta/responses.js';
import type { FitAssessment, FitAssessmentInput } from '../prompts/fit.js';
import { runConversationTurn } from './turn.js';

// AGENT_BRAIN.md section 2: the chat route and the conversation turn must
// contain no regex or URL branching on the user message. The model decides
// everything; code only enforces guardrails. This scan fails on the old
// no-link quick path (isUrl/stripHtml/canned reply) if it ever returns.
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const SCANNED = [
  'apps/web/src/app/api/chat/route.ts',
  'packages/core/src/conversation/turn.ts',
];

const BANNED: Array<{ label: string; pattern: RegExp }> = [
  { label: 'URL sniffing helper', pattern: /\bisUrl\b/ },
  { label: 'HTML strip helper', pattern: /stripHtml/ },
  { label: 'startsWith http branch', pattern: /startsWith\(\s*['"]http/ },
  { label: 'hardcoded URL literal', pattern: /https?:\/\// },
  { label: 'new URL on message text', pattern: /new\s+URL\s*\(\s*(message|text|input|userText|t\b)/ },
  { label: 'regex match/test on text', pattern: /\.\s*(match|test)\s*\(/ },
  { label: 'old no-link canned reply', pattern: /Send me a link/ },
];

describe('no regex or URL branching on user text', () => {
  it('chat route and conversation turn leave every message to the model', () => {
    const hits: string[] = [];
    for (const rel of SCANNED) {
      const text = readFileSync(join(ROOT, rel), 'utf-8');
      for (const { label, pattern } of BANNED) {
        if (pattern.test(text)) hits.push(`${rel}: ${label}`);
      }
    }
    expect(hits, `URL branching in message handling:\n${hits.join('\n')}`).toEqual([]);
  });
});

function ev(value: string) {
  return { value, evidence_quote: value, source_url: 'https://example.edu/a', confidence: 'high' as const, needs_human: false, checked: true };
}

function stubExtraction(): Extraction {
  return {
    opportunity_type: 'academic_program',
    program: { name: ev('Computer Science MS'), unit: ev('Engineering'), institution: ev('Example University'), portal_url: null, language_read: 'en' },
    opens: null,
    deadlines: [],
    documents: [],
    eligibility: [],
    people: [],
    tests: [],
    money: [],
    unusual_rules: [],
  };
}

function textResult(text: string, responseId: string, costUsd = 0.004): ResponsesCallResult {
  return {
    responseId,
    model: 'muse-spark-1.3',
    inputTokens: 100,
    outputTokens: 50,
    costUsd,
    items: [{ type: 'message', content: [{ type: 'output_text', text }] }],
  };
}

function callResult(name: string, args: unknown, responseId: string): ResponsesCallResult {
  return {
    responseId,
    model: 'muse-spark-1.3',
    inputTokens: 120,
    outputTokens: 30,
    costUsd: 0.003,
    items: [{ type: 'function_call', id: 'call_1', call_id: 'call_1', name, arguments: JSON.stringify(args) }],
  };
}

interface Harness {
  run: RunRecord;
  events: RunEvent[];
  seen: StreamCallOptions[];
  fetchUrls: string[];
}

function makeHarness(script: ResponsesCallResult[]): Harness & { streamCall: (opts: StreamCallOptions) => Promise<ResponsesCallResult> } {
  const h: Harness = { run: newRun('run-1', 'user-1', 'chat-1'), events: [], seen: [], fetchUrls: [] };
  let n = 0;
  const streamCall = async (opts: StreamCallOptions): Promise<ResponsesCallResult> => {
    h.seen.push(opts);
    const next = script[Math.min(n, script.length - 1)];
    n += 1;
    for (const item of next.items) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part.text) opts.onText?.(part.text);
        }
      }
    }
    return next;
  };
  return { ...h, streamCall };
}

const stubPage = { url: 'https://example.edu/a', title: 'Example Admissions', text: 'Computer Science MS. Apply by January 5.', links: [], fromCache: false };

describe('conversation turn usage', () => {
  it('orchestrator turns never cost $0 (every model call is logged with cost)', async () => {
    const h = makeHarness([textResult('Here is what I found.', 'resp-1')]);
    const saved: RunRecord[] = [];
    const result = await runConversationTurn({
      run: h.run,
      save: async (r) => { saved.push(r); },
      userText: 'What do I need for a masters in computer science?',
      userId: 'user-1',
      send: (e) => h.events.push(e),
      streamCall: h.streamCall,
      fetchPage: async (url) => { h.fetchUrls.push(url); return stubPage; },
    });
    expect(result.gated).toBe(false);
    const usage = ((h.run.state as Record<string, unknown>)['conversation'] as { usage: Array<{ costUsd: number; role: string | null }> }).usage;
    expect(usage.length).toBeGreaterThan(0);
    for (const entry of usage) {
      expect(entry.costUsd).toBeGreaterThan(0);
    }
    const total = usage.reduce((sum, e) => sum + e.costUsd, 0);
    expect(total).toBeGreaterThan(0);
    expect(result.usageUsd).toBeGreaterThan(0);
    expect(h.fetchUrls).toEqual([]);
  });

  it('a sentence with no link gets a model text reply and no page fetch', async () => {
    const h = makeHarness([textResult('Tell me which field you are aiming at.', 'resp-1')]);
    let fetched = 0;
    const result = await runConversationTurn({
      run: h.run,
      save: async () => {},
      userText: 'I want to apply for a masters but I am not sure where to start',
      userId: 'user-1',
      send: (e) => h.events.push(e),
      streamCall: h.streamCall,
      fetchPage: async () => { fetched += 1; return stubPage; },
    });
    expect(result.gated).toBe(false);
    expect(result.text).toContain('which field');
    expect(fetched).toBe(0);
    const usage = ((h.run.state as Record<string, unknown>)['conversation'] as { usage: Array<{ role: string | null }> }).usage;
    expect(usage[0]?.role).toBe('orchestrator');
  });

  it('sends stored history on every call without chaining', async () => {
    const h = makeHarness([textResult('Second answer.', 'resp-2')]);
    h.run.messages.push({ role: 'user', text: 'first question' }, { role: 'assistant', text: 'First answer.' });
    await runConversationTurn({
      run: h.run,
      save: async () => {},
      userText: 'second question',
      userId: 'user-1',
      send: (e) => h.events.push(e),
      streamCall: h.streamCall,
    });
    expect(h.seen[0]?.previousResponseId).toBeNull();
    const flat = JSON.stringify(h.seen[0]?.input);
    expect(flat).toContain('first question');
    expect(flat).toContain('First answer.');
    expect(flat).toContain('second question');
  });

  it('a link message drives a read_page and emits a coverage card', async () => {
    const h = makeHarness([
      callResult('read_page', { url: 'https://example.edu/a' }, 'resp-1'),
      textResult('This looks like the Computer Science MS. Is that the one?', 'resp-2'),
    ]);
    const result = await runConversationTurn({
      run: h.run,
      save: async () => {},
      userText: 'https://example.edu/a',
      userId: 'user-1',
      send: (e) => h.events.push(e),
      streamCall: h.streamCall,
      fetchPage: async (url) => { h.fetchUrls.push(url); return stubPage; },
      readPageText: async () => ({ extraction: stubExtraction(), costUsd: 0.002, model: 'muse-spark-1.3', inputTokens: 80, outputTokens: 40 }),
    });
    expect(result.gated).toBe(false);
    expect(h.fetchUrls).toEqual(['https://example.edu/a']);
    expect(h.events.some((e) => e.t === 'card' && (e as { kind: string }).kind === 'coverage')).toBe(true);
    const mem = (h.run.state as Record<string, unknown>)['conversation'] as { programUrl: string | null };
    expect(mem.programUrl).toBe('https://example.edu/a');
  });

  it('a follow-up question replays stored history instead of chaining', async () => {
    const first = makeHarness([textResult('First answer.', 'resp-1')]);
    await runConversationTurn({
      run: first.run,
      save: async () => {},
      userText: 'first question',
      userId: 'user-1',
      send: () => {},
      streamCall: first.streamCall,
    });
    const second = makeHarness([textResult('Second answer.', 'resp-2')]);
    second.run = first.run;
    await runConversationTurn({
      run: second.run,
      save: async () => {},
      userText: 'what about fees?',
      userId: 'user-1',
      send: () => {},
      streamCall: second.streamCall,
    });
    // No chaining: the follow-up replays the persisted exchange instead.
    expect(second.seen[0]?.previousResponseId).toBeNull();
    const flat = JSON.stringify(second.seen[0]?.input);
    expect(flat).toContain('First answer.');
    expect(flat).toContain('what about fees?');
  });

  it('request_approval persists a chat-origin G1 gate', async () => {
    const h = makeHarness([
      callResult('request_approval', { gate: 'G1', what: 'Is this the one?', card: { kind: 'program', name: 'Computer Science MS', source_url: 'https://example.edu/a' } }, 'resp-1'),
    ]);
    const result = await runConversationTurn({
      run: h.run,
      save: async () => {},
      userText: 'https://example.edu/a',
      userId: 'user-1',
      send: (e) => h.events.push(e),
      streamCall: h.streamCall,
    });
    expect(result.gated).toBe(true);
    expect(result.gate).toBe('G1');
    expect(h.run.status).toBe('needs_approval');
    expect(h.run.pendingGate?.gate).toBe('G1');
    expect((h.run.pendingGate?.evidence as { origin?: string }).origin).toBe('chat');
    const mem = (h.run.state as Record<string, unknown>)['conversation'] as { gateContext: { gate: string; what: string } | null };
    expect('responseId' in mem).toBe(false);
    expect(mem.gateContext).toEqual({ gate: 'G1', what: 'Is this the one?' });
  });

  it('fails loudly after three transport attempts', async () => {
    const h = makeHarness([]);
    let calls = 0;
    const flaky: typeof h.streamCall = async (opts) => {
      calls += 1;
      h.seen.push(opts);
      throw new Error('responses stream HTTP 500');
    };
    await expect(runConversationTurn({
      run: h.run,
      save: async () => {},
      userText: 'hello again',
      userId: 'user-1',
      send: (e) => h.events.push(e),
      streamCall: flaky,
      sleepMs: async () => {},
    })).rejects.toThrow('after 3 attempts');
    expect(calls).toBe(3);
    expect(h.seen.every((o) => o.previousResponseId === null)).toBe(true);
  });

describe('settled extraction card guards', () => {
  function doc(name: string, optional = false) {
    return {
      value: { name, limit: null, optional },
      evidence_quote: name,
      source_url: 'https://example.edu/a',
      confidence: 'high' as const,
      needs_human: false,
      checked: true,
    };
  }

  function rule(text: string) {
    return {
      value: { rule: text, hard: true },
      evidence_quote: text,
      source_url: 'https://example.edu/a',
      confidence: 'high' as const,
      needs_human: false,
      checked: true,
    };
  }

  function jobExtraction(deadlines: Extraction['deadlines']): Extraction {
    return {
      ...stubExtraction(),
      opportunity_type: 'job',
      program: {
        ...stubExtraction().program,
        name: ev('Software Engineer'),
        institution: ev('Acme Corp'),
      },
      deadlines,
      documents: [doc('Resume'), doc('Portfolio', true)],
      eligibility: [rule('US work authorization required')],
    };
  }

  function isoDeadline(label: string, iso: string): Extraction['deadlines'][number] {
    return {
      label,
      field: {
        value: { iso_utc: iso, original_tz: 'America/New_York', all_day: false, rolling: false },
        evidence_quote: label,
        source_url: 'https://example.edu/a',
        confidence: 'high' as const,
        needs_human: false,
        checked: true,
      },
    };
  }

  function cardKinds(events: RunEvent[]): string[] {
    return events.filter((e) => e.t === 'card').map((e) => (e as { kind: string }).kind);
  }

  async function readOnce(extraction: Extraction): Promise<RunEvent[]> {
    const h = makeHarness([
      callResult('read_page', { url: 'https://example.edu/a' }, 'resp-1'),
      textResult('Here is what they ask for.', 'resp-2'),
    ]);
    await runConversationTurn({
      run: h.run,
      save: async () => {},
      userText: 'https://example.edu/a',
      userId: 'user-1',
      send: (e) => h.events.push(e),
      streamCall: h.streamCall,
      fetchPage: async () => stubPage,
      readPageText: async () => ({ extraction, costUsd: 0.002, model: 'muse-spark-1.3', inputTokens: 80, outputTokens: 40 }),
    });
    return h.events;
  }

  it('emits requirements and plan cards when checked ISO deadlines exist', async () => {
    const events = await readOnce(jobExtraction([isoDeadline('Apply by', '2026-12-01T04:59:59Z')]));
    const kinds = cardKinds(events);
    expect(kinds).toContain('requirements');
    expect(kinds).toContain('plan');
    expect(kinds).not.toContain('rolling_notice');
    const req = events.find((e) => e.t === 'card' && (e as { kind: string }).kind === 'requirements') as unknown as {
      payload: { documents: Array<{ name: string; optional: boolean }>; eligibility: Array<{ rule: string }> };
    };
    expect(req.payload.documents.map((d) => d.name)).toEqual(['Resume', 'Portfolio']);
    expect(req.payload.documents[1].optional).toBe(true);
    expect(req.payload.eligibility.map((e) => e.rule)).toEqual(['US work authorization required']);
    const plan = events.find((e) => e.t === 'card' && (e as { kind: string }).kind === 'plan') as unknown as {
      payload: { title: string; deadlines: string[]; portalUrl: string | null };
    };
    expect(plan.payload.title).toBe('Software Engineer');
    expect(plan.payload.deadlines).toEqual(['2026-12-01T04:59:59Z']);
  });

  it('emits a rolling notice and no plan card when no deadlines exist', async () => {
    const events = await readOnce(jobExtraction([]));
    const kinds = cardKinds(events);
    expect(kinds).toContain('requirements');
    expect(kinds).toContain('rolling_notice');
    expect(kinds).not.toContain('plan');
    const rolling = events.find((e) => e.t === 'card' && (e as { kind: string }).kind === 'rolling_notice') as unknown as {
      payload: { text: string };
    };
    expect(rolling.payload.text).toBe(
      'No fixed closing date found on this listing. Applications may be reviewed on a rolling basis.',
    );
  });

  it('treats unchecked deadlines as rolling, not planned', async () => {
    const unchecked = isoDeadline('Apply by', '2026-12-01T04:59:59Z');
    unchecked.field.checked = false;
    const events = await readOnce(jobExtraction([unchecked]));
    const kinds = cardKinds(events);
    expect(kinds).toContain('rolling_notice');
    expect(kinds).not.toContain('plan');
  });
});

  it('a turn after a gate restarts the chain with a text recap', async () => {
    const gate = makeHarness([
      callResult('request_approval', { gate: 'G1', what: 'Is this the one?', card: { kind: 'program', name: 'Computer Science MS', source_url: 'https://example.edu/a' } }, 'resp-gate'),
    ]);
    await runConversationTurn({
      run: gate.run,
      save: async () => {},
      userText: 'https://example.edu/a',
      userId: 'user-1',
      send: () => {},
      streamCall: gate.streamCall,
    });
    const next = makeHarness([textResult('Confirmed, moving on.', 'resp-next')]);
    next.run = gate.run;
    const result = await runConversationTurn({
      run: next.run,
      save: async () => {},
      userText: 'Yes, that is the one',
      userId: 'user-1',
      send: () => {},
      streamCall: next.streamCall,
    });
    expect(result.gated).toBe(false);
    // Fresh chain: the gate-ended response is not chainable, so the turn
    // sends plain text with a recap instead of previous_response_id.
    expect(next.seen[0]?.previousResponseId).toBeNull();
    const thread = JSON.stringify(next.seen[0]?.input);
    expect(Array.isArray(next.seen[0]?.input)).toBe(true);
    expect(thread).toContain('Is this the one?');
    expect(thread).toContain('Yes, that is the one');
  });

  it('a throwing tool returns a structured error and the turn continues', async () => {
    const h = makeHarness([
      callResult('list_reminders', {}, 'resp-1'),
      textResult('I could not load reminders, but here is what I found.', 'resp-2'),
    ]);
    const result = await runConversationTurn({
      run: h.run,
      save: async () => {},
      userText: 'what are my reminders?',
      userId: 'user-1',
      send: (e) => h.events.push(e),
      streamCall: h.streamCall,
      listReminders: async () => { throw new Error('reminders db down'); },
    });
    expect(result.gated).toBe(false);
    expect(result.text).toContain('here is what I found');
    const secondInput = JSON.stringify(h.seen[1]?.input);
    expect(secondInput).toContain('reminders db down');
  });

});

describe('fit read (M5, PROMPT.md 7.2)', () => {
  const assessment: FitAssessment = {
    matched: ['Your physics degree lines up with what they ask for.'],
    hard_gaps: [{ field: 'eligibility: minimum GPA', note: 'They want a first-class mark and your profile does not state one.' }],
    competitive_gaps: [{ field: 'documents: writing sample', note: 'Most admitted applicants submit a long writing sample.' }],
    biggest_risk: 'The grades bar is the part most likely to stop this.',
  };

  function fitExtraction(): Extraction {
    return {
      ...stubExtraction(),
      documents: [
        {
          value: { name: 'Transcript', limit: null, optional: false },
          evidence_quote: 'Transcript',
          source_url: 'https://example.edu/a',
          confidence: 'high' as const,
          needs_human: false,
          checked: true,
        },
      ],
      eligibility: [
        {
          value: { rule: 'A physics degree', hard: true },
          evidence_quote: 'physics degree',
          source_url: 'https://example.edu/a',
          confidence: 'high' as const,
          needs_human: false,
          checked: true,
        },
      ],
    };
  }

  function seedProfile(run: RunRecord): void {
    (run.state as Record<string, unknown>)['conversation'] = {
      profile: [{ question: 'What is your degree?', answer: 'A second-class degree in physics' }],
      fitAsked: false,
      fitDecision: null,
      pendingProfileQuestion: null,
    };
  }

  function memOf(run: RunRecord): { fitAsked: boolean; fitDecision: string | null; profile: Array<{ question: string; answer: string }>; pendingProfileQuestion: string | null } {
    return (run.state as Record<string, unknown>)['conversation'] as {
      fitAsked: boolean;
      fitDecision: string | null;
      profile: Array<{ question: string; answer: string }>;
      pendingProfileQuestion: string | null;
    };
  }

  interface FitPayload {
    title: string;
    program: string;
    lines_up: string[];
    stretch: string[];
    missing: string[];
    biggest_risk: string;
    question: string;
    options: string[];
  }

  function fitCards(events: RunEvent[]): FitPayload[] {
    return events
      .filter((e) => e.t === 'card' && (e as { kind: string }).kind === 'fit')
      .map((e) => (e as unknown as { payload: FitPayload }).payload);
  }

  async function settleWithProfile(over: { run?: RunRecord; seed?: boolean; assessFit?: (input: FitAssessmentInput) => Promise<FitAssessment> } = {}): Promise<{ events: RunEvent[]; run: RunRecord }> {
    const h = makeHarness([
      callResult('read_page', { url: 'https://example.edu/a' }, 'resp-1'),
      textResult('Here is my honest read.', 'resp-2'),
    ]);
    const run = over.run ?? h.run;
    if (over.seed !== false) seedProfile(run);
    const events: RunEvent[] = [];
    await runConversationTurn({
      run,
      save: async () => {},
      userText: 'https://example.edu/a',
      userId: 'user-1',
      send: (e) => events.push(e),
      streamCall: h.streamCall,
      fetchPage: async () => stubPage,
      readPageText: async () => ({ extraction: fitExtraction(), costUsd: 0.002, model: 'muse-spark-1.3', inputTokens: 80, outputTokens: 40 }),
      assessFit: over.assessFit ?? (async () => assessment),
    });
    return { events, run };
  }

  it('emits a plain-words fit card once extraction settles with profile facts', async () => {
    const { events, run } = await settleWithProfile();
    const cards = fitCards(events);
    expect(cards).toHaveLength(1);
    const payload = cards[0];
    expect(payload.title).toBe('How you match up');
    expect(payload.question).toBe('Want to go for it anyway?');
    expect(payload.options).toEqual(["Yes, let's apply", 'Not now']);
    expect(payload.lines_up).toEqual(assessment.matched);
    expect(payload.stretch).toEqual(assessment.competitive_gaps.map((g) => g.note));
    expect(payload.missing).toEqual(assessment.hard_gaps.map((g) => g.note));
    expect(payload.biggest_risk).toBe(assessment.biggest_risk);
    expect(JSON.stringify(payload)).not.toMatch(/[0-9]\s*%|\/100/);
    expect(memOf(run).fitAsked).toBe(true);
  });

  it('emits no fit card when the user stated no profile facts', async () => {
    const h = makeHarness([
      callResult('read_page', { url: 'https://example.edu/a' }, 'resp-1'),
      textResult('Here is what they ask for.', 'resp-2'),
    ]);
    let calls = 0;
    const events: RunEvent[] = [];
    await runConversationTurn({
      run: h.run,
      save: async () => {},
      userText: 'https://example.edu/a',
      userId: 'user-1',
      send: (e) => events.push(e),
      streamCall: h.streamCall,
      fetchPage: async () => stubPage,
      readPageText: async () => ({ extraction: fitExtraction(), costUsd: 0.002, model: 'muse-spark-1.3', inputTokens: 80, outputTokens: 40 }),
      assessFit: async () => { calls += 1; return assessment; },
    });
    expect(calls).toBe(0);
    expect(fitCards(events)).toHaveLength(0);
  });

  it('skips the fit card when the judge fails, without ending the turn', async () => {
    const { events, run } = await settleWithProfile({
      assessFit: async () => { throw new Error('judge down'); },
    });
    expect(fitCards(events)).toHaveLength(0);
    expect(memOf(run).fitAsked).toBe(false);
  });

  it('records the fit decision once in decisions and never asks again', async () => {
    const first = await settleWithProfile();
    expect(first.run.decisions).toHaveLength(0);

    const answer = makeHarness([textResult('Carrying on.', 'resp-3')]);
    const res = await runConversationTurn({
      run: first.run,
      save: async () => {},
      userText: "Yes, let's apply",
      userId: 'user-1',
      send: () => {},
      streamCall: answer.streamCall,
      assessFit: async () => assessment,
    });
    expect(res.gated).toBe(false);
    expect(first.run.decisions).toHaveLength(1);
    expect(first.run.decisions[0]).toMatchObject({ gate: 'G3', opId: 'fit-run-1' });
    expect((first.run.decisions[0].decision as { choice: string }).choice).toBe('apply');
    expect(JSON.stringify(answer.seen[0]?.input)).toContain('never ask again');

    const repeat = makeHarness([textResult('Still carrying on.', 'resp-4')]);
    await runConversationTurn({
      run: first.run,
      save: async () => {},
      userText: "Yes, let's apply",
      userId: 'user-1',
      send: () => {},
      streamCall: repeat.streamCall,
      assessFit: async () => assessment,
    });
    expect(first.run.decisions).toHaveLength(1);

    const settled = await settleWithProfile({ run: first.run, seed: false });
    expect(fitCards(settled.events)).toHaveLength(0);
  });

  it('rebuilds a recorded decision from stored decisions after a restart', async () => {
    const run = newRun('run-9', 'user-1', 'chat-9');
    run.decisions.push({ gate: 'G3', decision: { choice: 'not_now', question: 'go-for-it-anyway' }, opId: 'fit-run-9' });
    const { events } = await settleWithProfile({ run });
    expect(fitCards(events)).toHaveLength(0);
    expect(memOf(run).fitDecision).toBe('not_now');
  });

  it('stores answers to ask_profile_question as profile facts', async () => {
    const h = makeHarness([
      callResult('ask_profile_question', { question: 'What is your current degree?' }, 'resp-1'),
      textResult('Noted.', 'resp-2'),
    ]);
    await runConversationTurn({
      run: h.run,
      save: async () => {},
      userText: 'masters in physics',
      userId: 'user-1',
      send: () => {},
      streamCall: h.streamCall,
    });
    expect(memOf(h.run).pendingProfileQuestion).toBe('What is your current degree?');

    const h2 = makeHarness([textResult('Thanks.', 'resp-3')]);
    await runConversationTurn({
      run: h.run,
      save: async () => {},
      userText: 'A masters in physics',
      userId: 'user-1',
      send: () => {},
      streamCall: h2.streamCall,
    });
    expect(memOf(h.run).profile).toEqual([{ question: 'What is your current degree?', answer: 'A masters in physics' }]);
    expect(memOf(h.run).pendingProfileQuestion).toBeNull();
  });
});
