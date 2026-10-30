import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { newRun, type RunRecord } from '../agent/types.js';
import type { RunEvent } from '../schemas/events.js';
import type { Extraction } from '../schemas/extraction.js';
import type { ResponsesCallResult, StreamCallOptions } from '../meta/responses.js';
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

  it('forwards isGuest to every model call', async () => {
    const h = makeHarness([textResult('Hi.', 'resp-1')]);
    await runConversationTurn({
      run: h.run,
      save: async () => {},
      userText: 'hello',
      userId: 'guest-9',
      isGuest: true,
      send: (e) => h.events.push(e),
      streamCall: h.streamCall,
    });
    expect(h.seen[0]?.isGuest).toBe(true);
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

  it('a follow-up question chains the stored response id', async () => {
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
    expect(second.seen[0]?.previousResponseId).toBe('resp-1');
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
    const mem = (h.run.state as Record<string, unknown>)['conversation'] as { responseId: string | null; gateContext: { gate: string; what: string } | null };
    expect(mem.responseId).toBeNull();
    expect(mem.gateContext).toEqual({ gate: 'G1', what: 'Is this the one?' });
  });

  it('round 0 restarts the chain when the provider drops the stored response', async () => {
    const h = makeHarness([textResult('Recovered.', 'resp-fresh')]);
    let calls = 0;
    const flaky: typeof h.streamCall = async (opts) => {
      calls += 1;
      if (calls === 1) {
        h.seen.push(opts);
        throw new Error('responses stream HTTP 400 {"error":{"message":"referenced response not found or expired"}}');
      }
      return h.streamCall(opts);
    };
    h.run.state = { conversation: { ...((h.run.state as Record<string, unknown>)['conversation'] as object ?? {}), responseId: 'resp-stale' } };
    const result = await runConversationTurn({
      run: h.run,
      save: async () => {},
      userText: 'hello again',
      userId: 'user-1',
      send: (e) => h.events.push(e),
      streamCall: flaky,
    });
    expect(result.gated).toBe(false);
    expect(result.text).toContain('Recovered');
    // First attempt chained, retry went fresh.
    expect(h.seen[0]?.previousResponseId).toBe('resp-stale');
    expect(h.seen[1]?.previousResponseId).toBeNull();
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
    const firstInput = next.seen[0]?.input as unknown;
    expect(typeof firstInput).toBe('string');
    expect(firstInput as string).toContain('Is this the one?');
    expect(firstInput as string).toContain('Yes, that is the one');
  });
});
