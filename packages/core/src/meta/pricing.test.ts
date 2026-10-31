import { describe, expect, it } from 'vitest';
import { costForVoice, VOICE_USD_PER_SECOND } from './pricing.js';

// Voice transcription is billed per hour ($0.18/hr, PROMPT.md section 4).
describe('costForVoice', () => {
  it('charges $0.18 per hour of audio', () => {
    expect(VOICE_USD_PER_SECOND).toBeCloseTo(0.18 / 3600, 12);
    expect(costForVoice(3600)).toBeCloseTo(0.18, 12);
    expect(costForVoice(60)).toBeCloseTo(0.003, 12);
  });

  it('floors at zero for empty or negative input', () => {
    expect(costForVoice(0)).toBe(0);
    expect(costForVoice(-5)).toBe(0);
  });
});
