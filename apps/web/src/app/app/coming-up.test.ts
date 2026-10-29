// Regression test for the Coming up flash bug: the card rendered from
// server data, then an effect read the dismiss flag after mount and hid it.
// Dismissal must be known before first paint, so the rule below is the
// invariant: given the same inputs, server and first client render agree.
// Run: node --test src/app/app/coming-up.test.ts (from apps/web).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISMISS_COOKIE,
  readDismissed,
  remindersVersion,
  shouldShowComingUp,
} from './coming-up.ts';

const A = { id: 'dev-seed-a', pill: 'in 3d', done: false, dueAt: '2026-11-01T00:00:00.000Z' };
const B = { id: 'dev-seed-b', pill: 'in 9d', done: false, dueAt: '2026-11-07T00:00:00.000Z' };

describe('coming-up visibility', () => {
  it('shows when reminders exist and nothing was dismissed', () => {
    assert.equal(shouldShowComingUp([A, B], null), true);
  });

  it('renders nothing when there are no reminders', () => {
    assert.equal(shouldShowComingUp([], null), false);
  });

  it('stays hidden when the stored dismissal matches the current version', () => {
    const v = remindersVersion([A, B]);
    assert.equal(shouldShowComingUp([A, B], v), false);
  });

  it('returns when a new reminder changes the version', () => {
    const before = remindersVersion([A]);
    const c = { ...B, id: 'fresh-id' };
    assert.equal(shouldShowComingUp([A, c], before), true);
  });

  it('returns when a reminder becomes due (pill changes)', () => {
    const before = remindersVersion([A]);
    assert.equal(shouldShowComingUp([{ ...A, pill: 'due today' }], before), true);
  });

  it('reads the dismissal from the request cookie before first paint', () => {
    const v = remindersVersion([A, B]);
    const header = `mizzou-anon-id=abc; ${DISMISS_COOKIE}=${encodeURIComponent(v)}`;
    assert.equal(readDismissed(header), v);
  });

  it('reads null when the cookie is absent (SSR or fresh browser)', () => {
    assert.equal(readDismissed(null), null);
    assert.equal(readDismissed('mizzou-anon-id=abc'), null);
  });

  it('server and first client render agree on the same inputs', () => {
    const reminders = [A, B];
    const header = `${DISMISS_COOKIE}=${encodeURIComponent(remindersVersion(reminders))}`;
    const server = shouldShowComingUp(reminders, readDismissed(header));
    const firstClientRender = shouldShowComingUp(reminders, readDismissed(header));
    assert.equal(server, firstClientRender);
    assert.equal(server, false);
  });
});
