// Guest-run cap (Part A step 3). Guests get a small number of new runs per
// day; every scan turn after that is refused with one friendly message.
// Server-only: route handlers and server actions.

import 'server-only';

import { limitsFromEnv } from '@mizzou/core';

/** Daily guest run budget (GUEST_RUNS_PER_DAY, default 3). */
export function guestRunLimit(): number {
  return limitsFromEnv().guestRunsPerDay;
}

/** The refusal every guest sees on the 4th run of the day. */
export function guestRunsExhaustedMessage(limit: number): string {
  return `You've used your ${limit} guest runs for today. Sign in with Google to keep going.`;
}

/**
 * Throw the friendly refusal when a guest already started `countToday`
 * runs today. Pure (no I/O) so the rule is unit-testable; routes pass the
 * count from the run ledger.
 */
export function assertGuestRunAllowed(countToday: number, limit?: number): void {
  const max = limit ?? guestRunLimit();
  if (countToday >= max) {
    throw new Error(guestRunsExhaustedMessage(max));
  }
}
