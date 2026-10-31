import { describe, expect, it } from 'vitest';
import { buildTitlePrompt, cleanTitle, titleFallback, uniqueTitle } from './title.js';

describe('chat titles', () => {
  it('falls back to the first 40 characters', () => {
    expect(titleFallback('  im interested in harvard masters in computer science, when does the application open?  '))
      .toBe('im interested in harvard masters in comp');
    expect(titleFallback('   ')).toBe('New chat');
  });

  it('builds a short prompt from both sides', () => {
    const prompt = buildTitlePrompt('when does it open?', 'It opens in October.');
    expect(prompt).toContain('2 to 4 word title');
    expect(prompt).toContain('when does it open?');
    expect(prompt).toContain('It opens in October.');
  });

  it('lists titles already used so the model avoids them', () => {
    const prompt = buildTitlePrompt('hi', 'hello', ['ETH fellowship dates', 'MIT application']);
    expect(prompt).toContain('ETH fellowship dates; MIT application');
  });

  it('cleans quotes and trailing punctuation', () => {
    expect(cleanTitle('"ETH fellowship dates."')).toBe('ETH fellowship dates');
    expect(cleanTitle('ETH\nfellowship!')).toBe('ETH fellowship');
  });

  it('makes titles unique, ignoring case', () => {
    expect(uniqueTitle('ETH dates', [])).toBe('ETH dates');
    expect(uniqueTitle('ETH dates', ['eth dates'])).toBe('ETH dates 2');
    expect(uniqueTitle('ETH dates', ['ETH dates', 'ETH dates 2'])).toBe('ETH dates 3');
  });
});
