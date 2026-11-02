// Run: node --test "src/app/app/c/[chatId]/work-display.test.ts" (from apps/web).
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { buildDisplay, friendlyStatusLabel, isInternalUserLine } from './feed.ts';

const u = (id: string, text: string) => ({ id, kind: 'user', text });
const m = (id: string, text: string) => ({ id, kind: 'message', text });
const s = (id: string, label: string, state: string) => ({ id, kind: 'status', label, state });

describe('buildDisplay', () => {
  it('folds narration and steps into one row and keeps only the answer as a bubble', () => {
    const feed = [
      u('u1', 'is the scholarship open?'),
      m('a1', "I'll check the official page."),
      s('s1', 'Finding page details on cam.ac.uk', 'done'),
      m('a2', 'That link did not work, trying again.'),
      s('s2', 'Finding page details on cam.ac.uk', 'failed'),
      m('a3', 'It looks open for 2027, but I have not confirmed it on the official page.'),
    ];
    const out = buildDisplay(feed, false);
    assert.deepEqual(out.map((x) => x.kind), ['user', 'work', 'message']);
    const work = out[1] as { lines: Array<{ text: string; state?: string }>; active: boolean };
    assert.equal(work.lines.length, 4);
    assert.equal(work.active, false);
    assert.match(work.lines[3]?.text ?? '', /Could not open cam\.ac\.uk/);
    assert.equal((out[2] as { id: string }).id, 'a3');
  });

  it('keeps the bubble that introduces a card', () => {
    const feed = [u('u1', 'hi'), s('s1', 'Reading admissions details', 'done'), m('a1', 'Is this the one?'), { id: 'g1', kind: 'g1' }];
    assert.deepEqual(buildDisplay(feed, false).map((x) => x.kind), ['user', 'work', 'message', 'g1']);
  });

  it('shows a working row right away while streaming and animates the last row', () => {
    assert.deepEqual(buildDisplay([u('u1', 'hi')], true).map((x) => x.kind), ['user', 'work']);
    const out = buildDisplay([u('u1', 'hi'), s('s1', 'Finding the right page', 'active')], true);
    assert.equal((out[1] as { active: boolean }).active, true);
  });

  it('never shows gate answers stored as user lines', () => {
    const out = buildDisplay([u('u1', 'The user answered G1: {"confirmed":true}'), m('a1', 'Done.')], false);
    assert.deepEqual(out.map((x) => x.kind), ['message']);
    assert.ok(isInternalUserLine('The user answered G5: {}'));
  });

  it('leaves other labels alone', () => {
    assert.equal(friendlyStatusLabel('Reading X admissions details', 'done'), 'Reading X admissions details');
  });
});
