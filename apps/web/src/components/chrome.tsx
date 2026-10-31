'use client';

import { ArrowUp } from 'lucide-react';

// Shared composer for Home. White pill, hairline border, blue send button
// that is blue only when there is text. Styles live in globals.css
// (.mz-composer-*). No attachment control: uploads are not wired yet, so
// nothing is offered.

export function Composer({
  value,
  onChange,
  onSend,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
}) {
  const hasText = value.trim().length > 0;
  return (
    <div className="mz-composer-wrap">
      <div className="mz-composer-pill">
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
          disabled={!hasText}
          style={{ background: hasText ? "var(--mz-blue)" : "var(--mz-muted)" }}
        >
          <ArrowUp size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
