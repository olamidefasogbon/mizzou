'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { sendVoiceNote, startVoiceRecording, VOICE_MAX_SECONDS, type VoiceRecording } from './voice-note';

// 60-second record button for the composers. The transcript lands in the
// composer as EDITABLE text (onTranscript appends); nothing is auto-sent.
// Mic denied, no support, over-long, and failure states are plain text.
function formatElapsed(totalSeconds: number): string {
  const capped = Math.min(totalSeconds, VOICE_MAX_SECONDS);
  return `0:${capped < 10 ? '0' : ''}${capped}`;
}

export function VoiceButton({
  disabled,
  onTranscript,
}: {
  disabled?: boolean;
  onTranscript: (text: string) => void;
}): React.JSX.Element {
  const [phase, setPhase] = useState<'idle' | 'recording' | 'working' | 'error'>('idle');
  const [note, setNote] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const recRef = useRef<VoiceRecording | null>(null);
  const timerRef = useRef<unknown>(null);
  const finishRef = useRef<() => void>(() => {});

  const clearTimer = (): void => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current as ReturnType<typeof setInterval>);
    timerRef.current = null;
  };

  useEffect(
    () => () => {
      clearTimer();
      recRef.current?.stop();
      recRef.current = null;
    },
    [],
  );

  const start = (): void => {
    if (disabled || phase === 'recording' || phase === 'working') return;
    setNote(null);
    setElapsed(0);
    void (async () => {
      try {
        const recording = await startVoiceRecording();
        recRef.current = recording;
        setPhase('recording');
        const startedAt = Date.now();
        timerRef.current = window.setInterval(() => {
          const seconds = Math.floor((Date.now() - startedAt) / 1000);
          setElapsed(seconds);
          if (seconds >= VOICE_MAX_SECONDS) {
            // The cap stops the recorder itself; move on to writing it down.
            finishRef.current();
          }
        }, 500);
      } catch (err) {
        setNote(err instanceof Error ? err.message : 'Voice notes need a browser with microphone support.');
        setPhase('error');
      }
    })();
  };

  const finish = (): void => {
    const recording = recRef.current;
    if (!recording || phase !== 'recording') return;
    recRef.current = null;
    clearTimer();
    setPhase('working');
    // End the recorder now. Without this the note only ended at the 60 second
    // cap, so "Writing down your note" hung for up to a minute.
    recording.stop();
    void (async () => {
      try {
        const wav = await recording.done;
        const out = await sendVoiceNote(wav.wavBase64);
        onTranscript(out.transcript);
        setPhase('idle');
      } catch (err) {
        setNote(err instanceof Error ? err.message : 'I could not transcribe that. Try again in a moment.');
        setPhase('error');
      }
    })();
  };

  finishRef.current = finish;

  return (
    <>
      {phase === 'recording' ? (
        <button type="button" className="mz-composer-attach" aria-label={`Stop recording (${formatElapsed(elapsed)})`} onClick={finish}>
          <Square size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          className="mz-composer-attach"
          aria-label="Record a voice note"
          onClick={start}
          disabled={disabled === true || phase === 'working'}
        >
          <Mic size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
      {phase === 'recording' ? <span className="mz-composer-progress">Recording {formatElapsed(elapsed)}</span> : null}
      {phase === 'working' ? <span className="mz-composer-progress">Writing down your note</span> : null}
      {phase === 'error' && note ? (
        <span className="mz-composer-progress" role="alert">
          {note}
        </span>
      ) : null}
    </>
  );
}
