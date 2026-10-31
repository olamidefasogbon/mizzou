import { describe, expect, it } from 'vitest';
import { newRun } from '../agent/types.js';
import type { RunEvent } from '../schemas/events.js';
import type { Extraction } from '../schemas/extraction.js';
import type { ResponsesCallResult, StreamCallOptions } from '../meta/responses.js';
import { runConversationTurn } from './turn.js';

// Vision seeds (upload route) merge like a read page: same requirements
// card, same evidence, nothing auto-accepted, and the orchestrator is told
// the G1 program card is still unconfirmed. No model calls beyond the
// mocked orchestrator round (tests stay free).
function ev(value: string, quote: string, checked = true) {
  return { value, evidence_quote: quote, source_url: 'upload:upl-seed1', confidence: 'high' as const, needs_human: false, checked };
}

function seedExtraction(): Extraction {
  return {
    opportunity_type: 'academic_program',
    program: {
      name: ev('Computer Science MS', 'Computer Science MS'),
      unit: ev('Engineering', 'College of Engineering'),
      institution: ev('Example University', 'Example University'),
      portal_url: null,
      language_read: 'en',
    },
    opens: null,
    deadlines: [
      {
        label: 'Fall deadline',
        field: {
          value: { iso_utc: '2027-01-15T00:00:00Z', original_tz: null, all_day: true, rolling: false },
          evidence_quote: 'Fall deadline: January 15, 2027',
          source_url: 'upload:upl-seed1',
          confidence: 'high',
          needs_human: false,
          checked: true,
        },
      },
    ],
    documents: [{ value: { name: 'Transcript', limit: null, optional: false }, evidence_quote: 'Transcript', source_url: 'upload:upl-seed1', confidence: 'high', needs_human: false, checked: true }],
    eligibility: [],
    people: [],
    tests: [],
    money: [],
    unusual_rules: [],
  };
}

describe('vision seeds in the conversation turn', () => {
  it('merges the seed like a read page and tells the model G1 is unconfirmed', async () => {
    const events: RunEvent[] = [];
    const seen: StreamCallOptions[] = [];
    const reply: ResponsesCallResult = {
      responseId: 'resp-seed',
      model: 'muse-spark-1.3',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.004,
      items: [{ type: 'message', content: [{ type: 'output_text', text: 'Got it.' }] }],
    };
    const result = await runConversationTurn({
      run: newRun('run-seed', 'user-1', 'chat-1'),
      save: async () => {},
      userText: 'I uploaded this flyer',
      userId: 'user-1',
      seedExtractions: [{ id: 'upl-seed1', name: 'flyer.png', extraction: seedExtraction() }],
      send: (e) => events.push(e),
      streamCall: async (opts) => {
        seen.push(opts);
        opts.onText?.('Got it.');
        return reply;
      },
    });
    expect(result.gated).toBe(false);
    // Requirements card mirrors the checked seed extraction (upload source).
    const req = events.find((e) => e.t === 'card' && (e as { kind?: string }).kind === 'requirements') as unknown as {
      kind: string;
      payload: { documents: Array<{ name: string; source_url: string }>; eligibility: unknown[] };
    };
    expect(req).toBeDefined();
    expect(req.payload.documents[0]?.name).toBe('Transcript');
    expect(req.payload.documents[0]?.source_url).toBe('upload:upl-seed1');
    // Plan card goes out too (a valid ISO deadline exists).
    expect(events.some((e) => e.t === 'card' && (e as { kind?: string }).kind === 'plan')).toBe(true);
    // The orchestrator round carries the unconfirmed-G1 instruction.
    const input = JSON.stringify(seen[0]?.input ?? []);
    expect(input).toContain('G1 program card is NOT confirmed');
    // The seed merged exactly once: one requirements card, no duplicates.
    expect(events.filter((e) => e.t === 'card' && (e as { kind?: string }).kind === 'requirements')).toHaveLength(1);
  });
});
