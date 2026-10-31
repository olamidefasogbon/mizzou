import 'server-only';

import { META_BASE_URL, readApiKey } from '@mizzou/core';

// Voice-note intake (route: api/transcribe). The browser posts 16 kHz mono
// 16-bit WAV (PROMPT.md 4); the server checks the header (valid WAV, at most
// 60 seconds) and forwards to the Meta speech endpoint. Server-only.
export const VOICE_MODEL = 'muse-voice-transcribe-1.0';
export const MAX_VOICE_SECONDS = 60;

export interface WavInfo {
  seconds: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

/** Parse a PCM WAV header. Null when the bytes are not a WAV we accept. */
export function parseWav(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const tag = (at: number): string => String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || tag(12) !== 'fmt ') return null;
  const audioFormat = u16(view, 20);
  if (audioFormat !== 1) return null; // PCM only
  const channels = u16(view, 22);
  const sampleRate = u32(view, 24);
  const bitsPerSample = u16(view, 34);
  if (channels < 1 || sampleRate < 1000 || bitsPerSample !== 16) return null;
  // Find the data chunk (fmt may carry extra bytes; chunks may follow).
  let at = 12 + 8 + u32(view, 16);
  while (at + 8 <= bytes.length) {
    const id = tag(at);
    const size = u32(view, at + 4);
    if (id === 'data') {
      const bytesPerSample = (channels * bitsPerSample) / 8;
      const seconds = size / (sampleRate * bytesPerSample);
      if (!Number.isFinite(seconds) || seconds <= 0) return null;
      return { seconds, sampleRate, channels, bitsPerSample };
    }
    at += 8 + size;
  }
  return null;
}

export interface TranscribeResult {
  text: string;
  seconds: number;
}

/**
 * Forward one WAV note to the Meta speech endpoint. `fetchFn` is injectable
 * so tests never touch the network. Shape VERIFIED by the Oct 31 live probe
 * (docs/META_API_NOTES.md section 8): multipart `request` (JSON with model
 * plus audioEncoding "WAV") + `audio` (the WAV); the reply carries
 * `{transcript, turns, audioDurationMs}`.
 */
export async function transcribeWav(
  bytes: Uint8Array,
  info: WavInfo,
  opts: { fetchFn?: typeof fetch; apiKey?: string } = {},
): Promise<TranscribeResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const key = opts.apiKey ?? readApiKey();
  const form = new FormData();
  form.append('request', new Blob([JSON.stringify({ model: VOICE_MODEL, audioEncoding: 'WAV' })], { type: 'application/json' }));
  form.append('audio', new Blob([bytes as BlobPart], { type: 'audio/wav' }), 'note.wav');
  const res = await fetchFn(`${META_BASE_URL}/asr/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`transcription failed with HTTP ${res.status}`);
  }
  const data = (await res.json()) as { transcript?: unknown };
  if (typeof data.transcript !== 'string' || data.transcript.trim().length === 0) {
    throw new Error('transcription came back empty');
  }
  return { text: data.transcript.trim(), seconds: info.seconds };
}
