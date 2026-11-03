// Turn slice contract: the chat and resume routes share one budget read
// from MIZZOU_TURN_BUDGET_MS, defaulting to 28 s and clamped inside the
// safe range. Run: node --test src/lib/turn-budget.test.ts (from apps/web).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TURN_BUDGET_MS, MAX_TURN_BUDGET_MS, MIN_TURN_BUDGET_MS, turnBudgetMs } from './turn-budget.ts';

describe('turnBudgetMs', () => {
  it('defaults to 28 s when the env var is unset or blank', () => {
    assert.equal(turnBudgetMs({}), DEFAULT_TURN_BUDGET_MS);
    assert.equal(turnBudgetMs({ MIZZOU_TURN_BUDGET_MS: '' }), DEFAULT_TURN_BUDGET_MS);
    assert.equal(DEFAULT_TURN_BUDGET_MS, 28_000);
  });

  it('reads an explicit slice in range', () => {
    assert.equal(turnBudgetMs({ MIZZOU_TURN_BUDGET_MS: '30000' }), 30_000);
  });

  it('clamps outside values into the safe range and rejects garbage', () => {
    assert.equal(turnBudgetMs({ MIZZOU_TURN_BUDGET_MS: '1' }), MIN_TURN_BUDGET_MS);
    assert.equal(turnBudgetMs({ MIZZOU_TURN_BUDGET_MS: '90000' }), MAX_TURN_BUDGET_MS);
    assert.equal(turnBudgetMs({ MIZZOU_TURN_BUDGET_MS: 'soon' }), DEFAULT_TURN_BUDGET_MS);
  });
});
