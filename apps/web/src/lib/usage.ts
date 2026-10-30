// Per-request usage ledger backed by the Supabase usage table (P0-5).
// Routes snapshot today's spend, run the turn against a BudgetGuard over
// that snapshot, then flush the turn's completed calls. Caps survive
// serverless because the source of truth is the table, not process memory.

import 'server-only';

import type { UsageRecord, UsageStore } from '@mizzou/core';

export class RequestUsageStore implements UsageStore {
  private rows: UsageRecord[] = [];

  constructor(
    private baseUserSpend: number,
    private baseGlobalSpend: number,
  ) {}

  add(r: UsageRecord): void {
    this.rows.push(r);
  }

  spendSince(userId: string | null, sinceIso: string): number {
    const base = userId === null ? this.baseGlobalSpend : this.baseUserSpend;
    return (
      base +
      this.rows
        .filter((r) => r.at >= sinceIso && (userId === null || r.userId === userId))
        .reduce((sum, r) => sum + r.costUsd, 0)
    );
  }

  /** Completed calls this turn — flush to the usage table afterwards. */
  pending(): UsageRecord[] {
    return [...this.rows];
  }
}
