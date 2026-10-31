'use client';

import { ArrowUp } from 'lucide-react';
import { AttachButton, type AttachState } from './attach-button';
import { VoiceButton } from './voice-button';

// Shared composer for Home. White pill, hairline border, blue send button
// that is blue only when there is text (or a ready attachment). Styles live
// in globals.css (.mz-composer-*). Optional attach control: a flyer or
// screenshot uploads through /api/upload, then ships with the message.

export type ComposerAttach = {
  state: AttachState;
  disabled?: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
};

export type ComposerVoice = {
  disabled?: boolean;
  onTranscript: (text: string) => void;
};

export function Composer({
  value,
  onChange,
  onSend,
  attach,
  voice,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  attach?: ComposerAttach;
  voice?: ComposerVoice;
}) {
  const hasText = value.trim().length > 0;
  const hasReady = attach?.state.status === 'ready';
  const canSend = hasText || hasReady === true;
  return (
    <div className="mz-composer-wrap">
      <div className="mz-composer-pill">
        {attach ? (
          <AttachButton
            state={attach.state}
            disabled={attach.disabled}
            onPick={attach.onPick}
            onRemove={attach.onRemove}
          />
        ) : null}
        {voice ? <VoiceButton disabled={voice.disabled} onTranscript={voice.onTranscript} /> : null}
        <input
          className="mz-composer-input"
          aria-label="Message Mizzou"
          placeholder="Message Mizzou"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSend();
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
    </div>
  );
}
