// Voice-note WAV encoder round-trip: the browser's 16 kHz mono output must
// parse as a valid WAV with the right duration.
// Run: node --test src/components/voice-note.test.ts (from apps/web).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWavMono16, VOICE_MAX_SECONDS } from './voice-note.ts';
import { parseWav } from '../lib/transcribe.ts';
import { readFileSync } from 'node:fs';

const noteSrc = readFileSync(new URL('./voice-note.ts', import.meta.url), 'utf8');

describe('encodeWavMono16', () => {
  it('produces a parseable 16k mono wav with the right duration', () => {
    const samples = new Float32Array(16000 * 3);
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.sin((i / 16000) * 440 * 2 * Math.PI) * 0.5;
    const wav = encodeWavMono16(samples, 16000);
    assert.equal(wav.length, 44 + samples.length * 2);
    const info = parseWav(wav);
    assert.ok(info);
    assert.equal(info.seconds, 3);
    assert.equal(info.sampleRate, 16000);
    assert.equal(info.channels, 1);
  });

  it('clamps out-of-range samples instead of wrapping', () => {
    const wav = encodeWavMono16(new Float32Array([2, -2, 0]), 16000);
    const view = new DataView(wav.buffer);
    assert.equal(view.getInt16(44, true), 32767);
    assert.equal(view.getInt16(46, true), -32767);
    assert.equal(view.getInt16(48, true), 0);
  });

  it('caps notes at 60 seconds', () => {
    assert.equal(VOICE_MAX_SECONDS, 60);
  });

  it('posts wav to the transcribe route and never auto-sends', () => {
    assert.match(noteSrc, /fetch\('\/api\/transcribe',/);
    assert.match(noteSrc, /const targetRate = 16000/);
    assert.match(noteSrc, /new OfflineAudioContext\(1,/);
    assert.match(noteSrc, /encodeWavMono16\(samples, targetRate\)/);
    assert.doesNotMatch(noteSrc, /onSend/);
  });
});
