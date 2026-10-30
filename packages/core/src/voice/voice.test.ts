import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SAY_GOT_IT,
  SAY_ON_IT,
  SAY_PAGE_WOULD_NOT_OPEN,
  formatG1Prompt,
  hasBannedTerm,
} from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
const prompt = readFileSync(join(here, '..', 'prompts', 'orchestrator.md'), 'utf8');

// The three style examples from the prompt's voice section, plus the
// canned microcopy. Any banned term here fails the suite.
const SAMPLE_REPLIES = [
  'Found it — Northeastern\u2019s Align MSCS, no CS background needed. Is this the one?',
  'Two dates on this one: December 15 for the fellowship, January 5 for the program. Which should I plan around?',
  'That page won\u2019t open for me. Paste the text and I\u2019ll read it here.',
  SAY_ON_IT,
  SAY_GOT_IT,
  SAY_PAGE_WOULD_NOT_OPEN,
  formatG1Prompt('job'),
  formatG1Prompt('grant'),
];

const BAD_REPLIES = [
  'As an AI assistant, I found three options.',
  'Let me check the dashboard for your deadlines.',
  'The model suggests applying early.',
  'I am a chatbot trained on admissions data.',
];

describe('voice banned terms', () => {
  it('keeps system words out of every sample reply', () => {
    for (const reply of SAMPLE_REPLIES) {
      expect(hasBannedTerm(reply)).toBe(false);
    }
  });

  it('fails replies that use system words', () => {
    for (const reply of BAD_REPLIES) {
      expect(hasBannedTerm(reply)).toBe(true);
    }
  });

  it('writes the voice as texting-a-friend with examples, not a jargon list', () => {
    expect(prompt).toMatch(/sharp friend texting/i);
    expect(prompt).toMatch(/Three examples/);
    expect(prompt).not.toContain('never "AI"');
  });
});
