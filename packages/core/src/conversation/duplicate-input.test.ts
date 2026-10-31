import { describe, expect, it } from 'vitest';
import { newRun, type RunRecord } from '../agent/types.js';
import type { RunEvent } from '../schemas/events.js';
import type { ResponsesCallResult, ResponsesItem, StreamCallOptions } from '../meta/responses.js';
import { buildInput, runConversationTurn } from './turn.js';

// Regression for Vercel ref emvw9313r7nmok: the Responses API returned
// HTTP 400 "Duplicate item found with id rs_...:rs_..." on the second
// round after a tool call. Round output must assemble through buildInput
// only, replay each id at most once, never replay reasoning items, and a
// 400 must fail fast with zero retries.

function idsIn(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const ids: string[] = [];
  for (const item of input) {
    if (typeof item === 'object' && item !== null) {
      const id = (item as { id?: unknown }).id;
      if (typeof id === 'string') ids.push(id);
    }
  }
  return ids;
}

function duplicateIds(input: unknown): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const id of idsIn(input)) {
    if (seen.has(id)) dups.add(id);
    seen.add(id);
  }
  return [...dups];
}

function reasoningIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return (input as Array<{ type?: unknown; id?: unknown }>)
    .filter((item) => item.type === 'reasoning' && typeof item.id === 'string')
    .map((item) => item.id as string);
}

describe('buildInput', () => {
  it('replays each item id at most once, keeping the first position', () => {
    const history = [{ type: 'message', role: 'user', content: [] }];
    const reasoning = { type: 'reasoning', id: 'rs_dup:rs_dup' };
    const call = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'fetch_page', arguments: '{}' };
    const out = buildInput(history, [reasoning, call, reasoning, { ...call }]);
    expect(out).toHaveLength(3);
    expect(idsIn(out)).toEqual(['rs_dup:rs_dup', 'fc_1']);
  });

  it('dedupes id-less function_call_output items on call_id', () => {
    const output = (callId: string) => ({ type: 'function_call_output', call_id: callId, output: '{}' });
    const out = buildInput([], [output('call_1'), output('call_1'), output('call_2')]);
    expect(out).toHaveLength(2);
  });
});

function scriptedTurn(script: ResponsesCallResult[]): {
  seen: StreamCallOptions[];
  streamCall: (opts: StreamCallOptions) => Promise<ResponsesCallResult>;
} {
  const seen: StreamCallOptions[] = [];
  let n = 0;
  const streamCall = async (opts: StreamCallOptions): Promise<ResponsesCallResult> => {
    seen.push(opts);
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
  return { seen, streamCall };
}

const stubPage = {
  url: 'https://example.edu/a',
  title: 'Example Admissions',
  text: 'Computer Science MS. Apply by January 5.',
  links: [],
  fromCache: false,
};

function callItem(id: string, callId: string, name: string, args: unknown): ResponsesItem {
  return { type: 'function_call', id, call_id: callId, name, arguments: JSON.stringify(args) };
}

describe('duplicate-item regression turn', () => {
  it('runs two tool calls plus a follow-up with unique ids and a model-written final reply', async () => {
    const rsDup = { type: 'reasoning', id: 'rs_dup:rs_dup' } as ResponsesItem;
    const msg1: ResponsesItem = {
      type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text: 'Checking now.' }],
    };
    const { seen, streamCall } = scriptedTurn([
      {
        responseId: 'resp-1', model: 'muse-spark-1.3', inputTokens: 200, outputTokens: 40, costUsd: 0.001,
        // Simulates the old buggy transport: the reasoning item arrives
        // twice in one round's output (the exact rs_...:rs_... shape).
        items: [rsDup, { ...rsDup }, msg1, callItem('fc_1', 'call_fetch', 'fetch_page', { url: stubPage.url })],
      },
      {
        responseId: 'resp-2', model: 'muse-spark-1.3', inputTokens: 300, outputTokens: 30, costUsd: 0.001,
        items: [callItem('fc_2', 'call_rem', 'list_reminders', {})],
      },
      {
        responseId: 'resp-3', model: 'muse-spark-1.3', inputTokens: 400, outputTokens: 20, costUsd: 0.001,
        items: [{ type: 'message', id: 'msg_3', role: 'assistant', content: [{ type: 'output_text', text: 'Here is what I found.' }] }],
      },
    ]);
    const run: RunRecord = newRun('run-dup', 'user-1', 'chat-1');
    const events: RunEvent[] = [];
    const result = await runConversationTurn({
      run,
      save: async () => {},
      userText: 'What do I need for the computer science masters?',
      userId: 'user-1',
      send: (e) => events.push(e),
      streamCall,
      fetchPage: async () => stubPage,
      listReminders: async () => [],
    });

    expect(seen).toHaveLength(3);
    // Round two: the duplicated reasoning item is gone entirely (reasoning
    // is never replayed) and every other id appears exactly once.
    expect(reasoningIds(seen[1]?.input)).toEqual([]);
    expect(JSON.stringify(seen[1]?.input)).not.toContain('rs_dup');
    expect(duplicateIds(seen[1]?.input)).toEqual([]);
    expect(idsIn(seen[1]?.input)).toContain('fc_1');
    // Round three: still unique after the second tool call, call pair kept.
    expect(reasoningIds(seen[2]?.input)).toEqual([]);
    expect(duplicateIds(seen[2]?.input)).toEqual([]);
    const flat3 = JSON.stringify(seen[2]?.input);
    expect(flat3).toContain('call_fetch');
    expect(flat3).toContain('call_rem');
    // The turn ends on the model-written final reply, not on an error.
    expect(result.gated).toBe(false);
    expect(result.text).toBe('Checking now.Here is what I found.');
    expect(events.some((e) => e.t === 'message')).toBe(true);

    // Follow-up user message replays the stored exchange through buildInput.
    const follow = scriptedTurn([
      {
        responseId: 'resp-4', model: 'muse-spark-1.3', inputTokens: 400, outputTokens: 20, costUsd: 0.001,
        items: [{ type: 'message', id: 'msg_4', role: 'assistant', content: [{ type: 'output_text', text: 'Fees are listed too.' }] }],
      },
    ]);
    const followEvents: RunEvent[] = [];
    const followResult = await runConversationTurn({
      run,
      save: async () => {},
      userText: 'and the fees?',
      userId: 'user-1',
      send: (e) => followEvents.push(e),
      streamCall: follow.streamCall,
      fetchPage: async () => stubPage,
      listReminders: async () => [],
    });
    expect(followResult.gated).toBe(false);
    expect(followResult.text).toBe('Fees are listed too.');
    const followFlat = JSON.stringify(follow.seen[0]?.input);
    expect(followFlat).toContain('and the fees?');
    expect(followFlat).toContain('Here is what I found.');
    expect(duplicateIds(follow.seen[0]?.input)).toEqual([]);
  });

  it('a 400 fails fast: one attempt, no sleeps, full provider message', async () => {
    const providerBody = JSON.stringify({
      error: {
        message: 'Duplicate item found with id `rs_x:rs_y`. Remove duplicate items from your input',
        type: 'invalid_request_error',
      },
    });
    let calls = 0;
    let sleeps = 0;
    const failing = async (opts: StreamCallOptions): Promise<ResponsesCallResult> => {
      calls += 1;
      void opts;
      const err = new Error(`responses stream HTTP 400: ${providerBody}`) as Error & { status?: number };
      err.status = 400;
      throw err;
    };
    const run: RunRecord = newRun('run-400', 'user-1', 'chat-1');
    await expect(
      runConversationTurn({
        run,
        save: async () => {},
        userText: 'hello again',
        userId: 'user-1',
        send: () => {},
        streamCall: failing,
        sleepMs: async () => { sleeps += 1; },
      }),
    ).rejects.toThrow('Duplicate item found with id `rs_x:rs_y`');
    expect(calls).toBe(1);
    expect(sleeps).toBe(0);
  });
});
