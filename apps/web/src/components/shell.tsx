'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EvidenceProvider } from './evidence';
import { Panel } from './panel';
import { StoreProvider } from './store-context';
import type { AppData } from '@/lib/actions';
import shell from './shell.module.css';

// Single centered column plus overlays (docs/design/UI_CORRECTIONS.md).
// No pinned sidebar, rail, collapse button or evidence rail.

function TopBar({
  onMenu,
  onNewChat,
  menuRef,
}: {
  onMenu: () => void;
  onNewChat: () => void;
  menuRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div className={shell.topbar}>
      <button
        ref={menuRef}
        type="button"
        onClick={onMenu}
        aria-label="Open menu"
        className={`mz-glass mz-icon-btn ${shell.topLeft}`}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
          <path d="M4 8h16M4 16h10" />
        </svg>
      </button>
      <div className={`mz-wordmark ${shell.wordmark}`} aria-hidden="true">
        Mizzou
      </div>
      <button
        type="button"
        onClick={onNewChat}
        aria-label="New chat"
        className={`mz-icon-btn ${shell.topRight} ${shell.solidBtn}`}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 5H8.5A3.5 3.5 0 005 8.5v7A3.5 3.5 0 008.5 19h7a3.5 3.5 0 003.5-3.5V12M17.5 4.5a1.8 1.8 0 012.5 2.5L12 15l-3.5.5L9 12z" />
        </svg>
      </button>
    </div>
  );
}

function ShellBody({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [panelOpen, setPanelOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement | null>(null);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    menuRef.current?.focus();
  }, []);

  const goNew = useCallback(() => {
    setPanelOpen(false);
    router.push('/app');
  }, [router]);

  // Lock page scroll while the overlay panel is open.
  useEffect(() => {
    if (!panelOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [panelOpen]);

  return (
    <div className={`mz-shell ${shell.root}`}>
      <TopBar onMenu={() => setPanelOpen(true)} onNewChat={goNew} menuRef={menuRef} />
      <div className={shell.main}>
        <div className={shell.mainInner}>{children}</div>
      </div>
      {panelOpen ? (
        <>
          <button type="button" aria-label="Close menu" className={shell.scrim} onClick={closePanel} />
          <div className={shell.overlay} role="dialog" aria-modal="true" aria-label="Menu">
            <Panel onNavigate={goNew} onClose={closePanel} />
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function AppShell({ initial, children }: { initial: AppData; children: React.ReactNode }) {
  return (
    <StoreProvider initial={initial}>
      <EvidenceProvider>
        <ShellBody>{children}</ShellBody>
      </EvidenceProvider>
    </StoreProvider>
  );
}
