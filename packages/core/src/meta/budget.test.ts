import { describe, expect, it } from 'vitest';
import {
  BudgetExceededError,
  BudgetGuard,
  FRIENDLY_BUDGET_MESSAGE,
  InMemoryUsageStore,
  limitsFromEnv,
} from './budget.js';
import { costForCall, estimateCostForPrompt } from './pricing.js';

describe('pricing', () => {
  it('prices a deep scan near the documented $0.14 Spark estimate', () => {
    // PROMPT.md section 4: ~75k input + 10k output tokens ≈ $0.14 on Spark.
    const cost = costForCall('muse-spark-1.3', 75_000, 10_000);
    expect(cost).toBeCloseTo(0.13625, 5);
  });

  it('falls back to Spark pricing for unknown models', () => {
    expect(costForCall('nope-9', 1_000_000, 0)).toBe(1.25);
  });

  it('estimates pre-call cost from prompt text', () => {
    expect(estimateCostForPrompt('muse-spark-1.3', 'x'.repeat(400))).toBeGreaterThan(0);
  });
});

describe('limitsFromEnv', () => {
  it('uses spec defaults when env is empty', () => {
    expect(limitsFromEnv({} as NodeJS.ProcessEnv)).toEqual({
      perUserDailyUsd: 1.0,
      globalDailyUsd: 15,
      guestRunsPerDay: 3,
    });
  });

  it('reads dev overrides from env', () => {
    const limits = limitsFromEnv({
      PER_USER_DAILY_USD: '0.50',
      GLOBAL_DAILY_USD: '5',
      GUEST_RUNS_PER_DAY: '3',
    } as NodeJS.ProcessEnv);
    expect(limits).toEqual({ perUserDailyUsd: 0.5, globalDailyUsd: 5, guestRunsPerDay: 3 });
  });
});

describe('BudgetGuard', () => {
  it('allows calls under budget and records spend', () => {
    const guard = new BudgetGuard(new InMemoryUsageStore(), {
      perUserDailyUsd: 1.0,
      globalDailyUsd: 15,
      guestRunsPerDay: 3,
    });
    guard.checkBeforeCall({ userId: 'u1', model: 'muse-spark-1.3', promptText: 'hello' });
    const cost = guard.recordCall({ userId: 'u1', model: 'muse-spark-1.3', promptTokens: 1000, completionTokens: 500 });
    expect(cost).toBeCloseTo(costForCall('muse-spark-1.3', 1000, 500), 8);
    expect(guard.spendToday('u1')).toBeCloseTo(cost, 8);
  });

  it('blocks a user over their daily budget with the friendly message', () => {
    const guard = new BudgetGuard(new InMemoryUsageStore(), {
      perUserDailyUsd: 0.000001,
      globalDailyUsd: 15,
      guestRunsPerDay: 3,
    });
    expect(() => guard.checkBeforeCall({ userId: 'u1', model: 'muse-spark-1.3', promptText: 'x'.repeat(4000) }))
      .toThrowError(BudgetExceededError);
    try {
      guard.checkBeforeCall({ userId: 'u1', model: 'muse-spark-1.3', promptText: 'x'.repeat(4000) });
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      expect((err as Error).message).toBe(FRIENDLY_BUDGET_MESSAGE);
      expect((err as BudgetExceededError).scope).toBe('user');
    }
  });

  it('caps guest runs per day', () => {
    const store = new InMemoryUsageStore();
    const guard = new BudgetGuard(store, { perUserDailyUsd: 15, globalDailyUsd: 15, guestRunsPerDay: 1 });
    guard.checkBeforeCall({ userId: 'guest-1', model: 'muse-spark-1.3', promptText: 'hi', isGuest: true });
    guard.recordCall({ userId: 'guest-1', model: 'muse-spark-1.3', promptTokens: 10, completionTokens: 10 });
    expect(() => guard.checkBeforeCall({ userId: 'guest-1', model: 'muse-spark-1.3', promptText: 'hi', isGuest: true }))
      .toThrowError(BudgetExceededError);
  });
});
