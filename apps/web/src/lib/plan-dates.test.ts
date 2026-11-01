// Regression: a screenshot with May and June 2026 dates produced a plan with
// "Approve and sync" on 1 Nov 2026. Run: node --test src/lib/plan-dates.test.ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { upcomingDeadlines } from './plan-dates.ts';

const now = new Date('2026-11-01T18:00:00Z');

describe('upcomingDeadlines', () => {
  it('drops deadlines before today and keeps the rest in order', () => {
    assert.deepEqual(
      upcomingDeadlines(['2026-05-26T23:59:00Z', '2026-06-12T23:59:00Z', '2026-12-01T23:59:00Z', '2027-01-15T23:59:00Z'], now),
      ['2026-12-01T23:59:00Z', '2027-01-15T23:59:00Z'],
    );
  });

  it('returns nothing when every date has passed', () => {
    assert.deepEqual(upcomingDeadlines(['2026-05-26T23:59:00Z'], now), []);
  });

  it('drops values that are not dates instead of syncing garbage', () => {
    assert.deepEqual(upcomingDeadlines(['soon', '2026-12-01T00:00:00Z'], now), ['2026-12-01T00:00:00Z']);
  });
});
