// Pure feed helpers for the conversation screen (unit-tested in
// feed.test.ts). Kept free of React so plain node:test can cover them.

export interface FeedEntry {
  id: string;
  kind: string;
}

/**
 * One bubble per assistant message, in arrival order. Deltas append only
 * to the latest bubble; a delta for an older id (after a card or status
 * rendered) opens a fresh bubble instead of gluing text onto a buried one.
 */
export function messageBubble(feed: FeedEntry[], eventId: string): { id: string; append: boolean } {
  const last = feed[feed.length - 1];
  if (last && last.kind === 'message' && (last.id === eventId || last.id.startsWith(eventId + '#'))) {
    return { id: last.id, append: true };
  }
  const seen = feed.some((item) => item.id === eventId);
  return { id: seen ? eventId + '#' + feed.length : eventId, append: false };
}

/** True when index starts a run of consecutive status items. */
export function statusRunHead(feed: FeedEntry[], index: number): boolean {
  const cur = feed[index];
  if (!cur || cur.kind !== 'status') return false;
  return index === 0 || feed[index - 1]?.kind !== 'status';
}

/** The consecutive status items starting at index (empty when none). */
export function statusRun(feed: FeedEntry[], index: number): FeedEntry[] {
  const run: FeedEntry[] = [];
  for (let j = index; j < feed.length; j += 1) {
    const next = feed[j];
    if (!next || next.kind !== 'status') break;
    run.push(next);
  }
  return run;
}

/** Same-sender bubbles sit 4px apart; a new group gets 12px. */
export function isTightGroup(feed: FeedEntry[], index: number): boolean {
  if (index <= 0) return false;
  const prev = feed[index - 1];
  const cur = feed[index];
  if (!prev || !cur) return false;
  return (cur.kind === 'user' && prev.kind === 'user') || (cur.kind === 'message' && prev.kind === 'message');
}
