import { describe, expect, it } from 'vitest';
import { acceptPolish, chooseAnswer } from './polish.js';

const original =
  'Yes, it looks open for 2027/28. The fee-waiver deadline is 20 November 2026, per https://mastercardfoundation.fund.cam.ac.uk/apply. I could not open the official page, so I have not verified the dates.';

describe('final-answer polish guard', () => {
  it('accepts a rewrite that keeps every number, link and caveat', () => {
    const good =
      "Good news, it looks open for 2027/28. The fee-waiver deadline is 20 November 2026 (https://mastercardfoundation.fund.cam.ac.uk/apply). Their official page wouldn't load for me, so I haven't confirmed the dates yet. Want me to try again?";
    expect(acceptPolish(original, good)).toBe(true);
    expect(chooseAnswer(original, good)).toBe(good);
  });

  it('falls back to the original when a date or link is lost', () => {
    expect(acceptPolish(original, 'It looks open and the deadline is in November. Want me to track it?')).toBe(false);
    expect(chooseAnswer(original, 'It looks open for 2027/28, deadline 20 November.')).toBe(original);
  });

  it('falls back when the rewrite is empty or ballooned', () => {
    expect(acceptPolish(original, '   ')).toBe(false);
    expect(acceptPolish(original, original + ' ' + 'x'.repeat(2000))).toBe(false);
    expect(chooseAnswer(original, null)).toBe(original);
  });

  it('always strips long dashes, even from the fallback', () => {
    expect(chooseAnswer('Found it — open until 5 May.', null)).toBe('Found it, open until 5 May.');
  });
});

describe('polish prompt', () => {
  it('never shows the model gate plumbing as something the person wrote', async () => {
    const { buildPolishPrompt } = await import('./polish.js');
    expect(buildPolishPrompt('The user answered G1: {"confirmed":true}', 'Okay.')).not.toContain('G1');
  });
});
