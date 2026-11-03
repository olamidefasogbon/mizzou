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
 * Fold activity into Work rows. A message is activity (not an answer) when
 * more activity follows it: the next item is a status or another message.
 * A message before a card or at the end stays a bubble. While `streaming`,
 * a lone row appears right after the person's message so work is visible at
 * once, and the last row stays animated.
 */
export function buildDisplay<T extends DisplaySource>(feed: T[], streaming: boolean): Array<T | WorkEntry> {
  const out: Array<T | WorkEntry> = [];
  let open: WorkEntry | null = null;
  const close = (): void => {
    open = null;
  };
  const group = (id: string): WorkEntry => {
    if (!open) {
      open = { id: `work-${id}`, kind: 'work', lines: [], active: false };
      out.push(open);
    }
    return open;
  };
  for (let i = 0; i < feed.length; i += 1) {
    const item = feed[i] as T;
    const next = feed[i + 1];
    if (item.kind === 'user') {
      close();
      if (!isInternalUserLine(item.text)) out.push(item);
      continue;
    }
    if (item.kind === 'status') {
      const g = group(item.id);
      const state = item.state === 'active' || item.state === 'failed' ? item.state : 'done';
      g.lines.push({ id: item.id, text: friendlyStatusLabel(item.label ?? 'Working', item.state), state });
      continue;
    }
    if (item.kind === 'message' && next && (next.kind === 'status' || next.kind === 'message')) {
      group(item.id).lines.push({ id: item.id, text: (item.text ?? '').trim() });
      continue;
    }
    close();
    out.push(item);
  }
  const last = out[out.length - 1];
  if (streaming) {
    if (last && last.kind === 'work') (last as WorkEntry).active = true;
    else if (last && last.kind === 'user') out.push({ id: 'work-pending', kind: 'work', lines: [], active: true });
  }
  return out;
}
