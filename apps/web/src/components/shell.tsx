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
  panelOpen,
}: {
  onMenu: () => void;
  onNewChat: () => void;
  menuRef: React.RefObject<HTMLButtonElement | null>;
  panelOpen: boolean;
}) {
  // One wordmark per screen: while the panel (which carries its own
  // wordmark) is open, the bar controls hide. They stay mounted so focus
  // returns to the menu button on close.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = (e: Event): void => {
      const target = e.target as (EventTarget & { scrollTop?: unknown }) | null;
      const y =
        target && typeof target.scrollTop === 'number' ? (target.scrollTop as number) : window.scrollY;
      setScrolled(y > 8);
    };
    setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', onScroll, { capture: true });
  }, []);
  const hidden = panelOpen ? shell.barHidden : '';
  return (
    <div className={`${shell.topbar} ${scrolled ? shell.scrolled : ''}`}>
      <div className={`mz-wordmark ${shell.wordmark} ${hidden}`} aria-hidden="true">
        Mizzou
      </div>
      <button
        ref={menuRef}
        type="button"
        onClick={onMenu}
        aria-label="Open menu"
        aria-hidden={panelOpen}
        tabIndex={panelOpen ? -1 : undefined}
        className={`mz-icon-btn ${shell.menuBtn} ${shell.solidBtn} ${hidden}`}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
          <path d="M4 8h16M4 16h10" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onNewChat}
        aria-label="New chat"
        className={`mz-icon-btn ${shell.newBtn} ${shell.solidBtn}`}
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
  const [panelSection, setPanelSection] = useState<string | null>(null);
  const menuRef = useRef<HTMLButtonElement | null>(null);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setPanelSection(null);
    menuRef.current?.focus();
  }, []);

  // Home's "See all" opens the menu at a section (UI_CORRECTIONS.md 3).
  useEffect(() => {
    const onOpenPanel = (e: Event) => {
      const section = (e as CustomEvent<{ section?: string }>).detail?.section ?? null;
      setPanelSection(section);
      setPanelOpen(true);
    };
    window.addEventListener('mz:open-panel', onOpenPanel);
    return () => window.removeEventListener('mz:open-panel', onOpenPanel);
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
      <TopBar onMenu={() => setPanelOpen(true)} onNewChat={goNew} menuRef={menuRef} panelOpen={panelOpen} />
      <div className={shell.main}>
        <div className={shell.mainInner}>{children}</div>
      </div>
      {panelOpen ? (
        <>
          <button type="button" aria-label="Close menu" className={shell.scrim} onClick={closePanel} />
          <div className={shell.overlay} role="dialog" aria-modal="true" aria-label="Menu">
            <Panel onNavigate={goNew} onClose={closePanel} section={panelSection} />
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
