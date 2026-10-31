// Writer prompt + schema (PROMPT.md 7.5). Drafts come from stated profile
// facts only; anything missing becomes [PLACEHOLDER], never an invention.
// Run: part of `pnpm --filter @mizzou/core test` (vitest run).
import { describe, expect, it } from 'vitest';
import { DraftSchema, buildWriterEditPrompt, buildWriterPrompt, isDraftKind } from './writer.js';

describe('isDraftKind', () => {
  it('accepts only the drafts table kinds', () => {
    expect(isDraftKind('statement')).toBe(true);
    expect(isDraftKind('email')).toBe(true);
    expect(isDraftKind('answer')).toBe(true);
    expect(isDraftKind('draft')).toBe(false);
    expect(isDraftKind('tweet')).toBe(false);
  });
});

describe('DraftSchema', () => {
  it('parses a body and rejects empties', () => {
    expect(DraftSchema.parse({ body: 'Dear committee,' }).body).toContain('committee');
    expect(() => DraftSchema.parse({ body: '' })).toThrow();
  });
});

describe('writer prompts', () => {
  const base = {
    kind: 'statement' as const,
    title: 'Statement of purpose',
    profile: [{ question: 'What is your degree?', answer: 'A second-class degree in physics' }],
    program: 'Example MS',
  };

  it('create prompt carries profile and program, and demands placeholders', () => {
    const prompt = buildWriterPrompt({ ...base, instructions: null });
    expect(prompt).toContain('second-class degree in physics');
    expect(prompt).toContain('Example MS');
    expect(prompt).toContain('[PLACEHOLDER]');
  });

  it('edit prompt carries the current draft and the instruction', () => {
    const prompt = buildWriterEditPrompt({ ...base, current: 'I love physics.', instruction: 'make it more academic' });
    expect(prompt).toContain('I love physics.');
    expect(prompt).toContain('make it more academic');
    expect(prompt).toContain('[PLACEHOLDER]');
  });
});
