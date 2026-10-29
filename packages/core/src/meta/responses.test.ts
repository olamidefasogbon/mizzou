import { describe, expect, it, vi, afterEach } from 'vitest';
import { BudgetExceededError, BudgetGuard, InMemoryUsageStore } from './budget.js';
import { costForCall } from './pricing.js';
import { responsesCall } from './responses.js';

function freshGuard(): BudgetGuard {
  return new BudgetGuard(new InMemoryUsageStore(), {
    perUserDailyUsd: 1.0,
    globalDailyUsd: 15,
    guestRunsPerDay: 3,
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
});
