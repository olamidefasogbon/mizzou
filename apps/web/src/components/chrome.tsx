'use client';

// Shared composer chrome. Meta.ai style: white surfaces, hairline borders,
// blue primary send. No blur, no glass.

export interface ChosenFile {
  name: string;
}

export function PlusMenu({ onPick }: { onPick: (file: File) => void }) {
  return (
    <div
      role="menu"
      style={{
        position: "absolute",
        left: 16,
        bottom: 100,
        width: 240,
        boxSizing: "border-box",
        padding: 8,
        borderRadius: 20,
        background: "#fff",
        border: "1px solid var(--mz-border)",
        boxShadow: "var(--mz-shadow-large)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          width: "100%",
          height: 52,
          padding: "0 14px",
          border: 0,
          borderRadius: 20,
          background: "transparent",
          fontFamily: "inherit",
          fontSize: 17,
          fontWeight: 500,
          color: "#000",
          textAlign: "left",
          cursor: "pointer",
          boxSizing: "border-box",
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5" />
        </svg>
        Photo library
        <input
          type="file"
          accept="image/*"
          aria-label="Photo library"
          style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
          }}
        />
      </label>
      <div style={{ height: 1, margin: "0 14px", background: "var(--mz-border)" }} />
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          width: "100%",
          height: 52,
          padding: "0 14px",
          border: 0,
          borderRadius: 20,
          background: "transparent",
          fontFamily: "inherit",
          fontSize: 17,
          fontWeight: 500,
          color: "#000",
          textAlign: "left",
          cursor: "pointer",
          boxSizing: "border-box",
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 8.5A2.5 2.5 0 016.5 6h1.2l1.3-2h6l1.3 2h1.2A2.5 2.5 0 0120 8.5v8A2.5 2.5 0 0117.5 19h-11A2.5 2.5 0 014 16.5z" />
          <circle cx="12" cy="12.5" r="3.4" />
        </svg>
        Take photo
        <input
          type="file"
          accept="image/*"
          capture="environment"
          aria-label="Take photo"
          style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
          }}
        />
      </label>
    </div>
  );
}

export function Composer({
  value,
  onChange,
  onSend,
  menuOpen,
  onToggleMenu,
  onPick,
  docked = true,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onPick: (file: File) => void;
  /** Absolute bottom-dock (conversation, mobile home) vs in-flow (tablet/desktop home). */
  docked?: boolean;
}) {
  const hasText = value.trim().length > 0;
  return (
    <div
      style={{
        position: docked ? "absolute" : "static",
        left: 0,
        right: 0,
        bottom: 0,
        boxSizing: "border-box",
        padding: "12px 16px calc(32px + env(safe-area-inset-bottom))",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <button
        type="button"
        onClick={onToggleMenu}
        aria-label={menuOpen ? "Close menu" : "Add a photo"}
        style={{
          flex: "none",
          width: 52,
          height: 52,
          borderRadius: 26,
          border: "1px solid var(--mz-border)",
          background: "#fff",
          boxShadow: "var(--mz-shadow)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: "#000",
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M12 5v14M5 12h14" />}
        </svg>
      </button>
      <div
        className="mz-composer-pill"
        style={{
          flex: 1,
          minWidth: 0,
          height: 52,
          boxSizing: "border-box",
          borderRadius: 26,
          background: "#fff",
          border: "1px solid var(--mz-border)",
          boxShadow: "var(--mz-shadow)",
          display: "flex",
          alignItems: "center",
          padding: "0 8px 0 20px",
          gap: 8,
        }}
      >
        <input
          className="mz-composer-input"
          aria-label="Message Mizzou"
          placeholder="Message Mizzou"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSend();
          }}
          style={{
            flex: 1,
            minWidth: 0,
            border: 0,
            background: "transparent",
            outline: "none",
            fontFamily: "inherit",
            fontSize: 17,
            color: "#000",
          }}
        />
        <button
          type="button"
          onClick={onSend}
          aria-label="Send"
          disabled={!hasText}
          style={{
            flex: "none",
            width: 36,
            height: 36,
            border: 0,
            borderRadius: 18,
            background: hasText ? "var(--mz-blue)" : "var(--mz-muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: hasText ? "pointer" : "default",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={hasText ? "#fff" : "#000"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5M6 11l6-6 6 6" />
          </svg>
        </button>
      </div>
      {menuOpen ? <PlusMenu onPick={onPick} /> : null}
    </div>
  );
}
