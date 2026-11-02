'use client';

import { useLayoutEffect, useRef } from 'react';
import { ArrowUp } from 'lucide-react';
import { AttachButton, type AttachState } from './attach-button';
import { VoiceButton } from './voice-button';

// Shared composer for Home and chat. Two rows inside one pill: the message
// box on top (it grows with long text, send beside it), the attach and voice
// tools underneath with their status text, then a one-line credit under the
// pill. Keeping the tools out of the text row is what stops long messages
// from being squeezed. White pill, hairline border, blue send button
// that is blue only when there is text (or a ready attachment). Styles live
// in globals.css (.mz-composer-*). Optional attach control: a flyer or
// screenshot uploads through /api/upload, then ships with the message.

export type ComposerAttach = {
  state: AttachState;
  disabled?: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
  queued?: boolean;
};

export type ComposerVoice = {
  disabled?: boolean;
  onTranscript: (text: string) => void;
};

const MAX_FIELD_HEIGHT = 160;

export function Composer({
  value,
  onChange,
  onSend,
  attach,
  voice,
  busy,
  flush,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  attach?: ComposerAttach;
  voice?: ComposerVoice;
  /** A run is streaming: no new message, picture or note until it ends. */
  busy?: boolean;
  /** Inside a screen that already pads its sides (the chat). */
  flush?: boolean;
}) {
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const hasText = value.trim().length > 0;
  const hasReady = attach?.state.status === 'ready';
  const canSend = busy !== true && attach?.queued !== true && (hasText || hasReady === true);

  // Grow with the text up to about six lines, then scroll inside the box.
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_FIELD_HEIGHT)}px`;
  }, [value]);

  return (
    <div className={flush === true ? 'mz-composer-wrap mz-composer-flush' : 'mz-composer-wrap'}>
      <div className="mz-composer-pill">
        <div className="mz-composer-field">
          <textarea
            ref={fieldRef}
            className="mz-composer-input"
            aria-label="Message Mizzou"
            placeholder="Message Mizzou"
            rows={1}
            enterKeyHint="send"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter adds a line; never mid-composition.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (canSend) onSend();
              }
            }}
          />
          <button
            type="button"
            className="mz-composer-send"
            onClick={onSend}
            aria-label="Send"
            disabled={!canSend}
            style={{ background: canSend ? "var(--mz-blue)" : "var(--mz-muted)" }}
          >
            <ArrowUp size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        {attach || voice ? (
          <div className="mz-composer-tools">
            {attach ? (
              <AttachButton
                state={attach.state}
                disabled={attach.disabled || busy === true}
                onPick={attach.onPick}
                onRemove={attach.onRemove}
                queued={attach.queued}
              />
            ) : null}
            {voice ? <VoiceButton disabled={voice.disabled || busy === true} onTranscript={voice.onTranscript} /> : null}
          </div>
        ) : null}
      </div>
      <p className="mz-composer-credit">Powered by Muse Spark</p>
    </div>
  );
}
