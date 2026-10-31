// Judge fit prompt + schema (PROMPT.md 7.2). The assessment is an
// internal-only object: no score, no numbers, plain words throughout.
// Run: part of `pnpm --filter @mizzou/core test` (vitest run).
import { describe, expect, it } from 'vitest';
import { FIT_JUDGE_SYSTEM_PROMPT, FitAssessmentSchema, buildFitPrompt } from './fit.js';

const SAMPLE = {
  matched: ['Your degree lines up with what they ask for.'],
  hard_gaps: [{ field: 'eligibility: minimum GPA', note: 'They want a first-class mark and your profile does not state one.' }],
  competitive_gaps: [{ field: 'documents: writing sample', note: 'Most admitted applicants submit a long writing sample.' }],
  biggest_risk: 'The grades bar is the part most likely to stop this.',
};

describe('FitAssessmentSchema', () => {
  it('parses a judge-shaped assessment with field-cited gaps', () => {
    const parsed = FitAssessmentSchema.parse(SAMPLE);
    expect(parsed.matched).toHaveLength(1);
    expect(parsed.hard_gaps[0]?.field).toBe('eligibility: minimum GPA');
    expect(parsed.biggest_risk.length).toBeGreaterThan(0);
  });

  it('rejects a non-object assessment', () => {
    expect(() => FitAssessmentSchema.parse(null)).toThrow();
    expect(() => FitAssessmentSchema.parse({ matched: 'yes' })).toThrow();
  });
});

describe('buildFitPrompt', () => {
  it('carries the profile facts and rules, and bans scores', () => {
    const prompt = buildFitPrompt({
      program: 'Example MS',
      rules: [{ rule: 'A first-class degree', hard: true }],
      documents: [{ name: 'Transcript', optional: false }],
      profile: [{ question: 'What is your degree?', answer: 'A second-class degree in physics' }],
    });
    expect(prompt).toContain('second-class degree in physics');
    expect(prompt).toContain('first-class degree');
    expect(prompt).toContain('PROFILE (question and answer)');
    expect(FIT_JUDGE_SYSTEM_PROMPT).toContain('No scores');
  });
});
