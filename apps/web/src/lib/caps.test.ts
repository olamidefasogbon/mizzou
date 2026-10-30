// Guest-run cap (Part A step 3): the 4th guest run of the day is refused
// with the friendly message. Pure rule plus the in-memory ledger count.
// Run: node --test src/lib/caps.test.ts (from apps/web).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { newRun } from '@mizzou/core';
import { assertGuestRunAllowed, guestRunLimit, guestRunsExhaustedMessage } from './caps.ts';
import { memoryRunLedger } from './repo.ts';

function runAt(userId: string, updatedAt: string) {
  const run = newRun(`run-${userId}-${updatedAt}`, userId, null);
  run.updatedAt = updatedAt;
  return run;
}

describe('guest run cap', () => {
  it('allows the first three guest runs of the day', () => {
    assertGuestRunAllowed(0);
    assertGuestRunAllowed(2);
  });

  it('refuses the 4th guest run with the friendly message', () => {
    assert.throws(
      () => assertGuestRunAllowed(3),
      (err: unknown) =>
        err instanceof Error &&
        err.message === "You've used your 3 guest runs for today. Sign in with Google to keep going.",
    );
    assert.equal(guestRunsExhaustedMessage(3), "You've used your 3 guest runs for today. Sign in with Google to keep going.");
  });

  it('counts only this user and only today', async () => {
    const ledger = memoryRunLedger();
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    ledger.seed(runAt('guest-1', `${today}T10:00:00.000Z`));
    ledger.seed(runAt('guest-1', `${today}T11:00:00.000Z`));
    ledger.seed(runAt('guest-1', `${today}T12:00:00.000Z`));
    ledger.seed(runAt('guest-1', `${yesterday}T10:00:00.000Z`));
    ledger.seed(runAt('guest-2', `${today}T10:00:00.000Z`));
    assert.equal(await ledger.countStartedToday('guest-1'), 3);
    assert.equal(await ledger.countStartedToday('guest-2'), 1);
    assert.equal(await ledger.countStartedToday('nobody'), 0);
    // The 4th run for guest-1 is refused with the same message the route sends.
    const count = await ledger.countStartedToday('guest-1');
    assert.throws(() => assertGuestRunAllowed(count), (err: unknown) => err instanceof Error && /guest runs for today/.test(err.message));
  });

  it('guestRunLimit defaults to the spec value of 3', () => {
    assert.equal(guestRunLimit(), 3);
  });
});
