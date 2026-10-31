import { describe, expect, it, vi, afterEach } from 'vitest';
import { BudgetExceededError, BudgetGuard, InMemoryUsageStore } from './budget.js';
import { costForCall } from './pricing.js';
import { responsesCall, streamResponsesCall } from './responses.js';

function freshGuard(): BudgetGuard {
  return new BudgetGuard(new InMemoryUsageStore(), {
    perUserDailyUsd: 1.0,
    globalDailyUsd: 15,
  });
}

function cannedFetch(body: unknown) {
  return vi.fn(async () => ({ ok: true, json: async () => body }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('responsesCall budget accounting', () => {
  it('records the orchestrator turn cost in the given guard', async () => {
    const guard = freshGuard();
    vi.stubGlobal('fetch', cannedFetch({
      id: 'resp_1',
      model: 'muse-spark-1.3',
      output: [],
      usage: { input_tokens: 1000, output_tokens: 50 },
    }));
    const out = await responsesCall({
      model: 'muse-spark-1.3',
      effort: 'medium',
      input: 'read the program page',
      budgetGuard: guard,
      userId: 'u1',
    });
    const expected = costForCall('muse-spark-1.3', 1000, 50);
    expect(out.costUsd).toBeCloseTo(expected, 10);
    // The guard's ledger sum — not a scalar on the side — holds every turn.
    expect(guard.spendToday('u1')).toBeCloseTo(expected, 10);
  });

  it('refuses before fetching when the guard is already hit', async () => {
    const guard = freshGuard();
    guard.recordCall({ userId: 'u1', model: 'muse-spark-1.3', promptTokens: 1_000_000, completionTokens: 0 });
    const fetchSpy = cannedFetch({ id: 'resp_x', output: [], usage: {} });
    vi.stubGlobal('fetch', fetchSpy);
    await expect(
      responsesCall({ model: 'muse-spark-1.3', input: 'later', budgetGuard: guard, userId: 'u1' }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sums every turn into one per-user total', async () => {
    const guard = freshGuard();
    vi.stubGlobal('fetch', cannedFetch({
      id: 'resp_2',
      model: 'muse-spark-1.3',
      output: [],
      usage: { input_tokens: 500, output_tokens: 25 },
    }));
    const opts = { model: 'muse-spark-1.3', input: 'x', budgetGuard: guard, userId: 'u1' } as const;
    const a = await responsesCall(opts);
    const b = await responsesCall(opts);
    expect(guard.spendToday('u1')).toBeCloseTo(a.costUsd + b.costUsd, 10);
  });

  it('emits each output item once when the completed envelope repeats done items', async () => {
    const reasoning = { type: 'reasoning', id: 'rs_dup:rs_dup', summary: [], status: 'completed' };
    const message = {
      type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text: 'hi' }],
    };
    const frames = [
      { type: 'response.output_item.done', item: reasoning },
      { type: 'response.output_item.done', item: message },
      {
        type: 'response.completed',
        response: {
          id: 'resp_1',
          model: 'muse-spark-1.3',
          usage: { input_tokens: 10, output_tokens: 5 },
          output: [reasoning, message],
        },
      },
    ];
    const text = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('');
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(text));
        c.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, body })));
    const guard = freshGuard();
    const out = await streamResponsesCall({ model: 'muse-spark-1.3', input: 'hi', budgetGuard: guard, userId: 'u1' });
    expect(out.items.map((i) => i.id)).toEqual(['rs_dup:rs_dup', 'msg_1']);
  });

  it('a 400 carries the full provider message and its status', async () => {
    const providerBody = JSON.stringify({
      error: {
        message: 'Duplicate item found with id `rs_x:rs_y`. Remove duplicate items from your input',
        type: 'invalid_request_error',
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, text: async () => providerBody })));
    const err = await responsesCall({ model: 'muse-spark-1.3', input: 'x', budgetGuard: freshGuard(), userId: 'u1' }).catch(
      (e: unknown) => e,
    );
    expect((err as { status?: number }).status).toBe(400);
    expect((err as Error).message).toContain('Duplicate item found with id `rs_x:rs_y`');
  });

  it('refuses an over-budget user without fetching', async () => {
    const guard = new BudgetGuard(new InMemoryUsageStore(), { perUserDailyUsd: 0.000001, globalDailyUsd: 15 });
    const fetchSpy = cannedFetch({ id: 'resp_g', output: [], usage: {} });
    vi.stubGlobal('fetch', fetchSpy);
    const err = await responsesCall({
      model: 'muse-spark-1.3',
      input: 'one more',
      budgetGuard: guard,
      userId: 'u1',
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect((err as BudgetExceededError).scope).toBe('user');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
