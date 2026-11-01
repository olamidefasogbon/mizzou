'use client';

import { useRef } from 'react';
import { ImagePlus, X } from 'lucide-react';

// Attach control shared by both composers (home chrome + chat). Quiet by
// design: a plain icon button, a name chip with remove, and plain progress
// or error text. Styled only by .mz-composer-* rules and tokens.
export type AttachState =
  | { status: 'idle' }
  | { status: 'uploading'; name: string }
  | { status: 'ready'; name: string }
  | { status: 'error'; message: string };

export function AttachButton({
  state,
  disabled,
  onPick,
  onRemove,
  queued,
}: {
  state: AttachState;
  disabled?: boolean;
  /** A message is waiting for the picture to finish reading. */
  queued?: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = disabled === true || state.status === 'uploading';

  // Type filtering stays server-side (magic bytes); the picker suggests
  // image types and anything else fails with the friendly upload message.
  const choose = (file: File | undefined): void => {
    if (!file) return;
    onPick(file);
  };

  return (
    <>
      <button
        type="button"
        className="mz-composer-attach"
        aria-label="Attach a flyer or screenshot"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
      >
        <ImagePlus size={20} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          choose(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {state.status === 'ready' ? (
        <span className="mz-composer-chip">
          <span className="mz-composer-chip-name">{state.name}</span>
          <button type="button" className="mz-composer-chip-remove" aria-label="Remove attachment" onClick={onRemove}>
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </span>
      ) : null}
      {state.status === 'uploading' ? <span className="mz-composer-progress">Reading {state.name}{queued ? ', then sending' : ''}</span> : null}
      {state.status === 'error' ? (
        <span className="mz-composer-progress" role="alert">
          {state.message}
        </span>
      ) : null}
    </>
  );
}
