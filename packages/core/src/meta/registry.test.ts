import { describe, expect, it } from 'vitest';
import { ROLE_MODEL_MAP } from './registry.js';

describe('ROLE_MODEL_MAP', () => {
  it('uses Spark defaults for the chat roles', () => {
    expect(ROLE_MODEL_MAP.orchestrator).toBe('muse-spark-1.3');
    expect(ROLE_MODEL_MAP.reader).toBe('muse-spark-1.3');
    expect(ROLE_MODEL_MAP.judge).toBe('muse-spark-1.3');
    expect(ROLE_MODEL_MAP.writer).toBe('muse-spark-1.3');
    expect(ROLE_MODEL_MAP.vision).toBe('muse-spark-1.3');
  });

  it('uses the transcribe model for the voice role', () => {
    expect(ROLE_MODEL_MAP.voice).toBe('muse-voice-transcribe-1.0');
  });

  it('is indexable by role', () => {
    expect(ROLE_MODEL_MAP['reader']).toBe(ROLE_MODEL_MAP.reader);
  });
});
