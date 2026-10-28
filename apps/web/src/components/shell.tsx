'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TopBar } from './chrome';
import { EvidenceProvider, useEvidence } from './evidence';
import { Panel } from './panel';
import { StoreProvider } from './store-context';
import type { AppData } from '@/lib/actions';
import shell from './shell.module.css';

// One AppShell, one CSS grid: var(--sidebar) minmax(0,1fr) var(--panel).
// Mobile <768: drawer. Tablet 768-1099: 72px rail, 304px overlay on tap.
// Desktop 1100+: 288px pinned sidebar (collapsible), 360px rail when open.
// Docs: docs/design/RESPONSIVE.md sections 1-3.

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    setMatch(m.matches);
    const onChange = (e: MediaQueryListEvent) => setMatch(e.matches);
    m.addEventListener('change', onChange);
    return () => m.removeEventListener('change', onChange);
  }, [query]);
  return match;
}

function NewChatIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5H8.5A3.5 3.5 0 005 8.5v7A3.5 3.5 0 008.5 19h7a3.5 3.5 0 003.5-3.5V12M17.5 4.5a1.8 1.8 0 012.5 2.5L12 15l-3.5.5L9 12z" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M4 8h16M4 16h10" />
    </svg>
  );
}

function RailStrip({ onOpen, onNew }: { onOpen: () => void; onNew: () => void }) {
  return (
    <div className={shell.railStrip} role="navigation" aria-label="Primary">
      <button type="button" onClick={onNew} aria-label="New chat" className={shell.railBtn}>
        <NewChatIcon />
      </button>
      <button type="button" onClick={onOpen} aria-label="Open menu" className={shell.railBtn}>
        <MenuIcon />
      </button>
      <div className={shell.railSpacer} />
      <button type="button" onClick={onOpen} aria-label="Account" className={shell.railBtn}>
        <span aria-hidden="true" className={shell.railAvatar}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#48484A" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="3.5" />
            <path d="M5 19a7 7 0 0114 0" />
          </svg>
        </span>
      </button>
    </div>
  );
}

function EvidenceRail({ onClose }: { onClose: () => void }) {
  const { selected } = useEvidence();
  return (
    <aside className={shell.rail} aria-label="Evidence">
      <div className={`mz-glass ${shell.railCard}`}>
        <div className={shell.railHead}>
          <p className={shell.railTitle}>Where I found this</p>
          <button type="button" onClick={onClose} aria-label="Close panel" className={shell.railClose}>
            ×
          </button>
        </div>
        {selected ? (
          <>
            <p className={shell.railDocTitle}>{selected.title}</p>
            <p className={shell.railQuote}>{selected.quote}</p>
            {selected.sourceUrl ? (
              <a className={shell.railLink} href={selected.sourceUrl} target="_blank" rel="noreferrer">
                Open the source page
              </a>
            ) : null}
          </>
        ) : (
          <p className={shell.railHint}>Tap &ldquo;Where I found this&rdquo; on any requirement to read its source here.</p>
        )}
      </div>
    </aside>
  );
}

function ShellBody({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [panelOpen, setPanelOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const wide = useMedia('(min-width: 1100px)');
  const { selected } = useEvidence();

  // Selecting evidence opens the rail on desktop (mobile expands inline).
  useEffect(() => {
    if (selected && window.matchMedia('(min-width: 1100px)').matches) setRailOpen(true);
  }, [selected]);

  const goNew = () => {
    setPanelOpen(false);
    router.push('/app');
  };

  return (
    <div
      className={`mz-shell ${shell.root}`}
      style={{ ...(collapsed ? { '--sidebar': '72px' } : null), ...(railOpen ? null : { '--panel': '0px' }) } as React.CSSProperties}
    >
      {/* Sidebar: drawer (mobile), rail + overlay (tablet), pinned (desktop). */}
      <div className={`${shell.sidebar} ${panelOpen ? shell.open : ''} ${collapsed ? shell.isCollapsed : ''}`}>
        <div className={shell.pinned}>
          <Panel onNavigate={() => setPanelOpen(false)} />
        </div>
        <button type="button" onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className={`mz-glass mz-icon-btn ${shell.collapseBtn}`}>
          {collapsed ? '»' : '«'}
        </button>
        <div className={shell.railCol}>
          <RailStrip onOpen={() => setPanelOpen(true)} onNew={goNew} />
        </div>
        {panelOpen ? (
          <div className={shell.overlay}>
            <Panel onNavigate={() => setPanelOpen(false)} />
          </div>
        ) : null}
      </div>
      {panelOpen ? <button type="button" aria-label="Close menu" className={shell.scrim} onClick={() => setPanelOpen(false)} /> : null}

      <div className={shell.main}>
        <div className={shell.mainInner}>
          <TopBar onMenu={() => setPanelOpen(true)} onNewChat={goNew} />
          {children}
        </div>
      </div>

      {wide && railOpen ? <EvidenceRail onClose={() => setRailOpen(false)} /> : null}
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
