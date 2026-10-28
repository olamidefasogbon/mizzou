'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { TopBar } from './chrome';
import { EvidenceProvider, useEvidence } from './evidence';
import { Panel } from './panel';
import shell from './shell.module.css';

// Responsive app shell: drawer under 768px, pinned panel + centered ~760px
// chat column at 768px+, right evidence rail at 1100px+ (Review.html pattern).

function EvidenceRail() {
  const { selected } = useEvidence();
  return (
    <aside className={shell.rail} aria-label="Evidence">
      <div className={`mz-glass ${shell.railCard}`}>
        <p className={shell.railTitle}>Where I found this</p>
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
  return (
    <div className={`mz-shell ${shell.root}`}>
      <div className={`${shell.panelWrap} ${panelOpen ? shell.open : ''}`}>
        <Panel onNavigate={() => setPanelOpen(false)} />
      </div>
      {panelOpen ? <button type="button" aria-label="Close menu" className={shell.scrim} onClick={() => setPanelOpen(false)} /> : null}
      <div className={shell.main}>
        <div className={shell.mainInner}>
          <TopBar onMenu={() => setPanelOpen(true)} onNewChat={() => router.push('/app')} />
          {children}
        </div>
      </div>
      <EvidenceRail />
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <EvidenceProvider>
      <ShellBody>{children}</ShellBody>
    </EvidenceProvider>
  );
}
