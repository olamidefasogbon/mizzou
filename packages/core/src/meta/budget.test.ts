import { describe, expect, it } from 'vitest';
import {
  BudgetExceededError,
  BudgetGuard,
  DAILY_LIMIT_MESSAGE,
  FRIENDLY_BUDGET_MESSAGE,
  InMemoryUsageStore,
  budgetFriendlyMessage,
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
    });
  });

  it('reads dev overrides from env', () => {
    const limits = limitsFromEnv({
      PER_USER_DAILY_USD: '5',
      GLOBAL_DAILY_USD: '25',
    } as NodeJS.ProcessEnv);
    expect(limits).toEqual({ perUserDailyUsd: 5, globalDailyUsd: 25 });
  });

  it('maps budget scopes to distinct user-facing text', () => {
    expect(budgetFriendlyMessage('user')).toBe(DAILY_LIMIT_MESSAGE);
    expect(budgetFriendlyMessage('global')).toBe(FRIENDLY_BUDGET_MESSAGE);
    expect(budgetFriendlyMessage('user')).not.toBe(budgetFriendlyMessage('global'));
  });
});

describe('BudgetGuard', () => {
  it('allows calls under budget and records spend', () => {
    const guard = new BudgetGuard(new InMemoryUsageStore(), {
      perUserDailyUsd: 1.0,
      globalDailyUsd: 15,
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
    });
    expect(() => guard.checkBeforeCall({ userId: 'u1', model: 'muse-spark-1.3', promptText: 'x'.repeat(4000) }))
      .toThrowError(BudgetExceededError);
    try {
      guard.checkBeforeCall({ userId: 'u1', model: 'muse-spark-1.3', promptText: 'x'.repeat(4000) });
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      expect((err as Error).message).toBe(FRIENDLY_BUDGET_MESSAGE);
      expect((err as BudgetExceededError).scope).toBe('user');
      expect((err as BudgetExceededError).limit).toBe(0.000001);
      expect((err as BudgetExceededError).amount).toBeGreaterThan(0.000001);
    }
  });

  it('blocks a global overage with the global scope', () => {
    const guard = new BudgetGuard(new InMemoryUsageStore(), { perUserDailyUsd: 15, globalDailyUsd: 0.000001 });
    try {
      guard.checkBeforeCall({ userId: 'u1', model: 'muse-spark-1.3', promptText: 'x'.repeat(4000) });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      expect((err as BudgetExceededError).scope).toBe('global');
      expect((err as BudgetExceededError).limit).toBe(0.000001);
      expect((err as BudgetExceededError).amount).toBeGreaterThan(0.000001);
    }
  });
});
