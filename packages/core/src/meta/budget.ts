import 'server-only';
import { costForCall, estimateCostForPrompt } from './pricing.js';

// Budget guard for PROMPT.md section 9.3.
// Every callModel checks these limits BEFORE sending, and records actual
// cost after. When a budget is hit, callers surface the friendly
// "I need a minute." message, never a stack trace.
//
// Limits come from env (see .env.example). Spec defaults are
// PER_USER_DAILY_USD=1.00 and GLOBAL_DAILY_USD=15; during development the
// spend rules pin them to 0.50 and 5.

export const FRIENDLY_BUDGET_MESSAGE = 'I need a minute.';

/** Shown when the signed-in user hits their own daily cap. */
export const DAILY_LIMIT_MESSAGE = "You've reached your daily limit. Try again tomorrow.";

export class BudgetExceededError extends Error {
  readonly scope: 'user' | 'global';
  readonly amount: number;
  readonly limit: number;
  constructor(
    scope: 'user' | 'global',
    message = FRIENDLY_BUDGET_MESSAGE,
    detail: { amount: number; limit: number } = { amount: 0, limit: 0 },
  ) {
    super(message);
    this.name = 'BudgetExceededError';
    this.scope = scope;
    this.amount = detail.amount;
    this.limit = detail.limit;
  }
}

/** User-facing text per budget scope: daily cap versus global minute. */
export function budgetFriendlyMessage(scope: 'user' | 'global'): string {
  return scope === 'user' ? DAILY_LIMIT_MESSAGE : FRIENDLY_BUDGET_MESSAGE;
}

export interface UsageRecord {
  userId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  at: string; // ISO date
}

/** Minimal usage ledger. Swap for a Supabase-backed store in M4/M7. */
export interface UsageStore {
  add(r: UsageRecord): void;
  spendSince(userId: string | null, sinceIso: string): number;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export class InMemoryUsageStore implements UsageStore {
  private rows: UsageRecord[] = [];

  add(r: UsageRecord): void {
    this.rows.push(r);
  }

  spendSince(userId: string | null, sinceIso: string): number {
    return this.rows
      .filter((r) => r.at >= sinceIso && (userId === null || r.userId === userId))
      .reduce((sum, r) => sum + r.costUsd, 0);
  }

  get size(): number {
    return this.rows.length;
  }
}

export interface BudgetLimits {
  perUserDailyUsd: number;
  globalDailyUsd: number;
}

export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env): BudgetLimits {
  const num = (v: string | undefined, fallback: number): number => {
    const n = v === undefined ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    // Spec defaults from section 9.3; .env.example pins dev values (5 / 25).
    perUserDailyUsd: num(env.PER_USER_DAILY_USD, 1.0),
    globalDailyUsd: num(env.GLOBAL_DAILY_USD, 15),
  };
}

export class BudgetGuard {
  constructor(
    private store: UsageStore = new InMemoryUsageStore(),
    private limits: BudgetLimits = limitsFromEnv(),
  ) {}

  get ledger(): UsageStore {
    return this.store;
  }

  /** Pre-call check. Throws BudgetExceededError when any budget is hit. */
  checkBeforeCall(opts: { userId: string; model: string; promptText: string }): number {
    const dayStart = `${todayUtc()}T00:00:00.000Z`;
    const estimated = estimateCostForPrompt(opts.model, opts.promptText);
    const globalSpent = this.store.spendSince(null, dayStart);
    if (globalSpent + estimated > this.limits.globalDailyUsd) {
      throw new BudgetExceededError('global', FRIENDLY_BUDGET_MESSAGE, {
        amount: globalSpent + estimated,
        limit: this.limits.globalDailyUsd,
      });
    }
    const userSpent = this.store.spendSince(opts.userId, dayStart);
    if (userSpent + estimated > this.limits.perUserDailyUsd) {
      throw new BudgetExceededError('user', FRIENDLY_BUDGET_MESSAGE, {
        amount: userSpent + estimated,
        limit: this.limits.perUserDailyUsd,
      });
    }
    return estimated;
  }

  /** Post-call record. Returns the recorded cost in USD. */
  recordCall(opts: {
    userId: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
  }): number {
    const costUsd = costForCall(opts.model, opts.promptTokens, opts.completionTokens);
    this.store.add({
      userId: opts.userId,
      model: opts.model,
      promptTokens: opts.promptTokens,
      completionTokens: opts.completionTokens,
      costUsd,
      at: new Date().toISOString(),
    });
    return costUsd;
  }

  spendToday(userId: string | null = null): number {
    return this.store.spendSince(userId, `${todayUtc()}T00:00:00.000Z`);
  }
}

/** Shared process-wide guard (in-memory until Supabase wiring in M4/M7). */
export const defaultBudgetGuard = new BudgetGuard();
