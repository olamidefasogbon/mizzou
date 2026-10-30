import { describe, expect, it } from 'vitest';
import { buildTitlePrompt, titleFallback } from './title.js';

describe('chat titles', () => {
  it('falls back to the first 40 characters', () => {
    expect(titleFallback('  im interested in harvard masters in computer science, when does the application open?  '))
      .toBe('im interested in harvard masters in comp');
    expect(titleFallback('   ')).toBe('New chat');
  });

  it('builds a short prompt from both sides', () => {
    const prompt = buildTitlePrompt('when does it open?', 'It opens in October.');
    expect(prompt).toContain('3 to 6 word title');
    expect(prompt).toContain('when does it open?');
    expect(prompt).toContain('It opens in October.');
  });
});
