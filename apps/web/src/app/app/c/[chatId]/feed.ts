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

/** End-of-stream sweep: any status row left active is closed, so no spinner survives the turn. */
export function settleActiveStatuses<T extends { kind: string; state?: string }>(feed: T[], state: 'done' | 'failed'): T[] {
  return feed.map((item) => (item.kind === 'status' && item.state === 'active' ? { ...item, state } : item));
}

/** Same-sender bubbles sit 4px apart; a new group gets 12px. */
export function isTightGroup(feed: FeedEntry[], index: number): boolean {
  if (index <= 0) return false;
  const prev = feed[index - 1];
  const cur = feed[index];
  if (!prev || !cur) return false;
  return (cur.kind === 'user' && prev.kind === 'user') || (cur.kind === 'message' && prev.kind === 'message');
}

// ---------------------------------------------------------------------------
// The "Working" row. While the agent iterates, its tool steps and the short
// lines it says between tool calls are activity, not conversation. They fold
// into one row (animated mark, latest line, tap for the list); only the
// answer, the cards and the person's own words stay in the feed.
// ---------------------------------------------------------------------------

export interface WorkLine {
  id: string;
  text: string;
  state?: 'active' | 'done' | 'failed';
}

export interface WorkEntry {
  id: string;
  kind: 'work';
  lines: WorkLine[];
  /** The agent is still going: animate the mark. */
  active: boolean;
}

interface DisplaySource {
  id: string;
  kind: string;
  text?: string;
  label?: string;
  state?: string;
}

/** A failed page read says what happened in plain words, not the step it was on. */
export function friendlyStatusLabel(label: string, state: string | undefined): string {
  const m = /^Finding page details on (.+)$/.exec(label);
  if (m && state === 'failed') return `Could not open ${m[1]}, trying another way`;
  return label;
}

/** Gate answers sent to the model as user lines are plumbing, never shown. */
export function isInternalUserLine(text: string | undefined): boolean {
  return typeof text === 'string' && (/^The user answered /.test(text) || text.startsWith('Carry on with the work you were doing.'));
}

/**
 * One Work row per request. Everything the agent did (steps, narration,
 * source lists) folds into a single row right under the person's message.
 * Only the answer and the cards stay in the feed: a message stays a bubble
 * when no more activity follows it. While `streaming`, the row is shown at
 * once and stays animated.
 */
export function buildDisplay<T extends DisplaySource>(feed: T[], streaming: boolean): Array<T | WorkEntry> {
  const out: Array<T | WorkEntry> = [];
  let seg: T[] = [];
  const flush = (isLast: boolean): void => {
    const lines: WorkEntry['lines'] = [];
    const rest: T[] = [];
    let firstId = 'pending';
    seg.forEach((item, idx) => {
      if (item.kind === 'coverage') return; // sources live in the row and the cards
      if (item.kind === 'status') {
        if (lines.length === 0) firstId = item.id;
        const state = item.state === 'active' || item.state === 'failed' ? item.state : 'done';
        lines.push({ id: item.id, text: friendlyStatusLabel(item.label ?? 'Working', item.state), state });
        return;
      }
      if (item.kind === 'message' && seg.slice(idx + 1).some((later) => later.kind === 'status' || later.kind === 'message')) {
        if (lines.length === 0) firstId = item.id;
        lines.push({ id: item.id, text: (item.text ?? '').trim() });
        return;
      }
      rest.push(item);
    });
    const live = streaming && isLast;
    if (lines.length > 0 || live) {
      out.push({ id: `work-${firstId}`, kind: 'work', lines, active: live });
    }
    out.push(...rest);
    seg = [];
  };
  for (const item of feed) {
    if (item.kind === 'user') {
      if (isInternalUserLine(item.text)) continue; // plumbing never splits a request
      flush(false);
      out.push(item);
      continue;
    }
    seg.push(item);
  }
  flush(true);
  return out;
}
