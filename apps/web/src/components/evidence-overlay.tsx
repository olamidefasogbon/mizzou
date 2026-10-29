'use client';

import { useEffect, useRef } from 'react';
import { useEvidence } from './evidence';
import styles from './evidence-overlay.module.css';

// "Where I found this" overlay (docs/design/UI_CORRECTIONS.md section 4).
// One mechanism: the inline expander is gone, only this overlay shows the
// quote. Mobile: bottom sheet. Tablet: right floating sheet with scrim.
// Desktop: right floating card, no scrim, closes on outside click.

function sourceHost(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null;
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function EvidenceOverlay(): React.JSX.Element | null {
  const { selected, clear } = useEvidence();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dragStartY = useRef<number | null>(null);

  useEffect(() => {
    if (!selected) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        clear();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [selected, clear]);

  // Drag-to-dismiss on the sheet handle (touch). The close button and
  // scrim/outside click always work, with or without drag.
  const onTouchStart = (e: React.TouchEvent) => {
    dragStartY.current = e.touches[0]?.clientY ?? null;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const start = dragStartY.current;
    const sheet = sheetRef.current;
    if (start === null || !sheet) return;
    const dy = (e.touches[0]?.clientY ?? start) - start;
    if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const start = dragStartY.current;
    const sheet = sheetRef.current;
    dragStartY.current = null;
    if (start === null || !sheet) return;
    const dy = (e.changedTouches[0]?.clientY ?? start) - start;
    sheet.style.transform = '';
    if (dy > 110) clear();
  };

  if (!selected) return null;
  const host = sourceHost(selected.sourceUrl);

  return (
    <div className={styles.root} onClick={clear}>
      <button type="button" aria-label="Close evidence" className={styles.scrim} onClick={clear} />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Where this was found: ${selected.title}`}
        className={`mz-glass ${styles.sheet}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={styles.handle}
          aria-hidden="true"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <span className={styles.handleBar} />
        </div>
        <div className={styles.head}>
          <p className={styles.title}>{selected.title}</p>
          <button type="button" ref={closeRef} aria-label="Close evidence" className={styles.close} onClick={clear}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <blockquote className={styles.quote}>&ldquo;{selected.quote}&rdquo;</blockquote>
        {host ? <p className={styles.source}>{host}</p> : null}
        {selected.sourceUrl ? (
          <a href={selected.sourceUrl} target="_blank" rel="noreferrer" className={styles.openLink}>
            Open the source page
          </a>
        ) : null}
      </div>
    </div>
  );
}
