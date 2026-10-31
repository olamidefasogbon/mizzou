// Voice-note intake: WAV header parsing and the ASR forward call with a
// mocked fetch (no network, no keys).
// Run: node --test src/lib/transcribe.test.ts (from apps/web).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_VOICE_SECONDS, parseWav, transcribeWav, VOICE_MODEL } from './transcribe.ts';

function wavBytes(seconds: number, sampleRate = 16000, channels = 1): Uint8Array {
  const data = seconds * sampleRate * channels * 2;
  const out = new Uint8Array(44 + data);
  const view = new DataView(out.buffer);
  const tag = (at: number, s: string): void => {
    for (let i = 0; i < 4; i += 1) view.setUint8(at + i, s.charCodeAt(i));
  };
  tag(0, 'RIFF');
  view.setUint32(4, 36 + data, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, data, true);
  return out;
}

describe('parseWav', () => {
  it('reads duration of a 16k mono note', () => {
    const info = parseWav(wavBytes(10));
    assert.ok(info);
    assert.equal(info.seconds, 10);
    assert.equal(info.sampleRate, 16000);
    assert.equal(info.channels, 1);
  });

  it('rejects non-wav, non-pcm and empty input', () => {
    assert.equal(parseWav(new Uint8Array(100)), null);
    assert.equal(parseWav(new Uint8Array(10)), null);
    const bad = wavBytes(5);
    bad[20] = 3; // IEEE float, not PCM
    assert.equal(parseWav(bad), null);
  });
});

describe('voice cap', () => {
  it('a 61s note exceeds the 60s cap', () => {
    const info = parseWav(wavBytes(61));
    assert.ok(info);
    assert.ok(info.seconds > MAX_VOICE_SECONDS);
  });
});

describe('transcribeWav', () => {
  it('posts request plus audio parts and returns the transcript', async () => {
    const bytes = wavBytes(4);
    const info = parseWav(bytes);
    assert.ok(info);
    let url = '';
    let auth = '';
    let requestJson = '';
    let audioName = '';
    const fetchFn = (async (u: string, init: { headers?: Record<string, string>; body?: FormData }) => {
      url = u;
      auth = init.headers?.['Authorization'] ?? '';
      const form = init.body as FormData;
      const req = form.get('request');
      requestJson = typeof req === 'string' ? req : await (req as Blob).text();
      const audio = form.get('audio');
      audioName = audio instanceof Blob ? (audio as File).name || 'blob' : '';
      return {
        ok: true,
        json: async () => ({ transcript: '  hello mizzou  ', turns: [], audioDurationMs: 4000 }),
      };
    }) as unknown as typeof fetch;
    const result = await transcribeWav(bytes, info, { fetchFn, apiKey: 'test-key' });
    assert.equal(result.text, 'hello mizzou');
    assert.equal(result.seconds, 4);
    assert.match(url, /\/asr\/transcribe$/);
    assert.equal(auth, 'Bearer test-key');
    const reqBody = JSON.parse(requestJson) as { model?: unknown; audioEncoding?: unknown };
    assert.equal(reqBody.model, VOICE_MODEL);
    assert.equal(reqBody.audioEncoding, 'WAV');
    assert.ok(audioName.length > 0);
  });

  it('throws a friendly-shaped error on http failure or empty text', async () => {
    const bytes = wavBytes(2);
    const info = parseWav(bytes);
    assert.ok(info);
    const failing = (async () => ({ ok: false, status: 429, json: async () => ({}) })) as unknown as typeof fetch;
    await assert.rejects(() => transcribeWav(bytes, info, { fetchFn: failing, apiKey: 'k' }), /HTTP 429/);
    const empty = (async () => ({ ok: true, json: async () => ({ transcript: '  ' }) })) as unknown as typeof fetch;
    await assert.rejects(() => transcribeWav(bytes, info, { fetchFn: empty, apiKey: 'k' }), /empty/);
  });
});
