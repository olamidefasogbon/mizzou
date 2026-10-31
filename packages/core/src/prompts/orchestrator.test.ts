import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hasLayoutReference } from '../voice/index.js';
import { CONVERSATION_MAX_ROUNDS } from '../conversation/turn.js';

const here = dirname(fileURLToPath(import.meta.url));
const prompt = readFileSync(join(here, 'orchestrator.md'), 'utf8');

// Sample assistant bubbles: what the model may say around cards.
const GOOD_SAMPLES = [
  'Quick check before I go further. Is this the fellowship you mean?',
  'Got everything. Here is my honest read. The deadline is December 1.',
  'I could not open that page. Paste the text and I will read it here.',
];

const BAD_SAMPLES = [
  'Is this the program in the card above?',
  'The details are listed below.',
];

describe('card order rule', () => {
  it('requires cards directly after their bubble and bans above/below', () => {
    expect(prompt).toContain('DIRECTLY after the bubble');
    expect(prompt).toMatch(/never describe/i);
  });

  it('passes clean sample bubbles', () => {
    for (const sample of GOOD_SAMPLES) {
      expect(hasLayoutReference(sample)).toBe(false);
    }
  });

  it('keeps autonomy: round cap 10-12 and read-only steps need no ask', () => {
    expect(CONVERSATION_MAX_ROUNDS).toBeGreaterThanOrEqual(10);
    expect(CONVERSATION_MAX_ROUNDS).toBeLessThanOrEqual(12);
    expect(prompt).toMatch(/read-only steps/i);
  });

  it('fails sample bubbles that point above or below', () => {
    for (const sample of BAD_SAMPLES) {
      expect(hasLayoutReference(sample)).toBe(true);
    }
  });

});
