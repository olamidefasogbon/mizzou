// Run: node --test src/app/app/c/[chatId]/feed.test.ts (from apps/web).
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { isTightGroup, messageBubble, statusRun, statusRunHead } from './feed.ts';

const msg = (id: string) => ({ id, kind: 'message' as const });
const user = (id: string) => ({ id, kind: 'user' as const });
const status = (id: string) => ({ id, kind: 'status' as const });

describe('messageBubble', () => {
  it('opens the first bubble for a new id', () => {
    assert.deepEqual(messageBubble([], 'm1'), { id: 'm1', append: false });
  });

  it('appends deltas to the latest bubble with the same id', () => {
    assert.deepEqual(messageBubble([msg('m1')], 'm1'), { id: 'm1', append: true });
  });

  it('appends deltas to a suffixed follow-up bubble', () => {
    assert.deepEqual(messageBubble([msg('m1'), msg('m1#2')], 'm1'), { id: 'm1#2', append: true });
  });

  it('opens a fresh suffixed bubble when the id is buried under other rows', () => {
    const feed = [msg('m1'), status('s1')];
    assert.deepEqual(messageBubble(feed, 'm1'), { id: 'm1#2', append: false });
  });

  it('opens a fresh bubble for an unseen id after other rows', () => {
    assert.deepEqual(messageBubble([msg('m1')], 'm2'), { id: 'm2', append: false });
  });
});

describe('status runs', () => {
  it('detects run heads and collects the run', () => {
    const feed = [msg('m1'), status('s1'), status('s2'), msg('m2')];
    assert.equal(statusRunHead(feed, 0), false);
    assert.equal(statusRunHead(feed, 1), true);
    assert.equal(statusRunHead(feed, 2), false);
    assert.deepEqual(statusRun(feed, 1).map((e) => e.id), ['s1', 's2']);
    assert.deepEqual(statusRun(feed, 0), []);
  });
});

describe('isTightGroup', () => {
  it('keeps same-sender bubbles tight and separates groups', () => {
    const feed = [user('u1'), user('u2'), msg('m1'), status('s1')];
    assert.equal(isTightGroup(feed, 0), false);
    assert.equal(isTightGroup(feed, 1), true);
    assert.equal(isTightGroup(feed, 2), false);
    assert.equal(isTightGroup(feed, 3), false);
  });
});
