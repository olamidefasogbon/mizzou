// Client-side voice notes (PROMPT.md 4, G). The browser records a short
// note, converts it to 16 kHz mono 16-bit WAV here, and posts it to
// /api/transcribe. The transcript lands in the composer as EDITABLE text:
// the user reviews, then sends. Never auto-sent. No core imports: this
// module runs in the browser.
export const VOICE_MAX_SECONDS = 60;

/** Encode mono float samples as 16-bit PCM WAV. Pure: unit-tested. */
export function encodeWavMono16(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const tag = (at: number, s: string): void => {
    for (let i = 0; i < 4; i += 1) view.setUint8(at + i, s.charCodeAt(i));
  };
  tag(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export interface VoiceNote {
  wavBase64: string;
  seconds: number;
}

export interface VoiceRecording {
  /** End the note now; `done` resolves with the WAV. */
  stop: () => void;
  done: Promise<VoiceNote>;
}

async function convertToWav(blob: Blob, maxSeconds: number): Promise<VoiceNote> {
    const buffer = await new Response(blob).arrayBuffer();
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) throw new Error('Voice notes need a browser with microphone support.');
    const audio = new AudioCtx();
    try {
      const decoded = await audio.decodeAudioData(buffer);
      const targetRate = 16000;
      const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetRate), targetRate);
      const source = offline.createBufferSource();
      // Downmix to mono: average every channel into one.
      const mono = offline.createBuffer(1, decoded.length, decoded.sampleRate);
      const target = mono.getChannelData(0);
      for (let ch = 0; ch < decoded.numberOfChannels; ch += 1) {
        const data = decoded.getChannelData(ch);
        for (let i = 0; i < data.length; i += 1) target[i] = (target[i] ?? 0) + (data[i] ?? 0) / decoded.numberOfChannels;
      }
      source.buffer = mono;
      source.connect(offline.destination);
      source.start();
      const rendered = await offline.startRendering();
      const samples = rendered.getChannelData(0).slice(0, targetRate * maxSeconds);
      const wav = encodeWavMono16(samples, targetRate);
      return { wavBase64: bytesToBase64(wav), seconds: samples.length / targetRate };
    } finally {
      await audio.close().catch(() => {});
    }
}

/**
 * Start a microphone recording. The caller ends it with `stop` (a 60s cap
 * stops it automatically); `done` resolves to 16 kHz mono 16-bit WAV.
 * Throws friendly messages for denied/unsupported/failed capture.
 */
export async function startVoiceRecording(maxSeconds = VOICE_MAX_SECONDS): Promise<VoiceRecording> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Voice notes need a browser with microphone support.');
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new Error('Microphone is blocked. Allow access and try again.');
  }
  const recorder = new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  // Opaque timer handle (DOM number or Node Timeout by lib order); only
  // ever passed back to clearTimeout.
  let timer: unknown = null;
  const finish = (fn: (track: MediaStreamTrack) => void): void => {
    for (const track of stream.getTracks()) fn(track);
  };
  const done = new Promise<VoiceNote>((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      if (timer !== null) window.clearTimeout(timer as ReturnType<typeof setTimeout>);
      finish((track) => track.stop());
      convertToWav(new Blob(chunks), maxSeconds).then(resolve, () =>
        reject(new Error('I could not read that recording. Try again in a moment.')),
      );
    };
    recorder.onerror = () => {
      if (timer !== null) window.clearTimeout(timer as ReturnType<typeof setTimeout>);
      finish((track) => track.stop());
      reject(new Error('Recording failed. Try again in a moment.'));
    };
    timer = window.setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, maxSeconds * 1000);
  });
  recorder.start();
  return {
    stop: () => {
      if (recorder.state !== 'inactive') recorder.stop();
    },
    done,
  };
}

/** Record one note (waits out the cap). UIs prefer startVoiceRecording. */
export async function recordVoiceNote(maxSeconds = VOICE_MAX_SECONDS): Promise<VoiceNote> {
  const recording = await startVoiceRecording(maxSeconds);
  return recording.done;
}

/** POST one WAV note; resolves the editable transcript. */
export async function sendVoiceNote(wavBase64: string): Promise<{ transcript: string; seconds: number }> {
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: wavBase64 }),
  });
  const data = (await res.json()) as { transcript?: unknown; seconds?: unknown; error?: unknown };
  if (!res.ok || typeof data.transcript !== 'string') {
    throw new Error(typeof data.error === 'string' ? data.error : 'I could not transcribe that. Try again in a moment.');
  }
  return { transcript: data.transcript, seconds: typeof data.seconds === 'number' ? data.seconds : 0 };
}
