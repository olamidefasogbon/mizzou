// Run: node --test src/lib/chat-groups.test.ts (from apps/web).
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { groupChatsByRecency } from './chat-groups.ts';
import type { ChatSummary } from './stores.ts';

function chat(id: string, updatedAt: string): ChatSummary {
  return { id, userId: 'u', title: id, updatedAt };
}

describe('groupChatsByRecency', () => {
  const now = new Date('2026-10-30T12:00:00');
  const daysAgo = (n: number): string => new Date(now.getTime() - n * 86_400_000).toISOString();

  it('buckets today, the previous 7 days, and older', () => {
    const groups = groupChatsByRecency(
      [chat('a', daysAgo(0)), chat('b', daysAgo(3)), chat('c', daysAgo(7)), chat('d', daysAgo(30))],
      now,
    );
    assert.deepEqual(groups.today.map((c) => c.id), ['a']);
    assert.deepEqual(groups.previous7d.map((c) => c.id), ['b', 'c']);
    assert.deepEqual(groups.older.map((c) => c.id), ['d']);
  });

  it('parks unparseable dates with older', () => {
    const groups = groupChatsByRecency([chat('x', 'not-a-date')], now);
    assert.deepEqual(groups.older.map((c) => c.id), ['x']);
  });
});
