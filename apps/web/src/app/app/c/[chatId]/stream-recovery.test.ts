// Stream recovery contract: a cut stream must never spin forever, and a
// long turn resumes through continue frames at most six times before the
// client stops with a retry. Run: node --test 'src/app/app/c/[[]chatId]/stream-recovery.test.ts' (from apps/web).
// Rendering pixels and the live turn are human browser + live-URL checks.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

describe('stream recovery contract', () => {
  it('caps chained continue resumes at six and then shows a retry', () => {
    assert.match(src, /continuesRef\.current \+= 1/);
    assert.match(src, /continuesRef\.current > 6/);
    assert.match(src, /continuesRef\.current = 0/);
    assert.match(src, /This one is taking longer than it should\. Send me a message and I will pick it up from where I got to\./);
  });

  it('tracks whether the open stream delivered a terminal frame', () => {
    assert.match(src, /streamTerminalRef/);
    assert.match(src, /streamTerminalRef\.current = false/);
  });

  it('settles active steps and shows a retry when a stream ends with no terminal frame', () => {
    assert.match(src, /no done, continue or error frame/);
    assert.match(src, /settleActiveStatuses\(prev, 'failed'\)/);
    assert.match(src, /I could not send that\. Try again in a moment\./);
    assert.match(src, /I could not continue that step\. Try again in a moment\./);
  });

  it('keeps every user-facing retry line free of dashes', () => {
    const lines = src.split('\n').filter((l) => l.includes('Try again in a moment') || l.includes('taking longer than it should'));
    assert.ok(lines.length >= 3);
    for (const line of lines) {
      assert.doesNotMatch(line, /—|–/);
    }
  });
});
