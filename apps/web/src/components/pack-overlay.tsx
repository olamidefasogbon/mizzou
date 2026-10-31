'use client';

import { X } from 'lucide-react';

import { useEffect, useRef, useState } from 'react';
import { CHECK_AGAINST_PORTAL, PACK_TITLE } from '@mizzou/core/voice';
import styles from './pack-overlay.module.css';

// Application Pack overlay (PROMPT.md 7.6). Opens from the chat's "View
// Application Pack" button once an opportunity is settled: checklist, kept
// copy-ready answers and emails with word counts and Copy buttons, and the
// portal button. Same overlay system as evidence (UI_CORRECTIONS.md
// section 4): bottom sheet on mobile, right sheet on tablet, floating card
// on desktop. Never resizes the page behind. Mizzou never sends anything;
// the user pastes, pays and clicks Submit.

export interface PackDraft {
  kind: string;
  title: string;
  body: string;
  kept: boolean;
}

export interface PackRequirementDoc {
  name: string;
  limit: string | null;
  optional: boolean;
  confidence: string;
  needs_human: boolean;
}

export interface PackRequirementRule {
  rule: string;
  confidence: string;
  needs_human: boolean;
}

export interface PackData {
  program: string;
  portalUrl: string | null;
  requirements: { documents: PackRequirementDoc[]; eligibility: PackRequirementRule[] };
  drafts: PackDraft[];
}

function wordCount(body: string): number {
  return body.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

function CopyButton({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={styles.copyBtn}
      onClick={() => {
        void copyText(text).then((ok) => {
          if (!ok) return;
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function needsLook(confidence: string, needsHuman: boolean): boolean {
  return needsHuman || confidence === 'low';
}

export function PackOverlay({ pack, onClose }: { pack: PackData; onClose: () => void }): React.JSX.Element {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dragStartY = useRef<number | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

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
    if (dy > 110) onClose();
  };

  const toggle = (key: string): void => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const answers = pack.drafts.filter((d) => d.kind === 'answer');
  const emails = pack.drafts.filter((d) => d.kind === 'email');
  const rows = [
    ...pack.requirements.documents.map((d) => ({
      key: `doc::${d.name}`,
      label: d.optional ? `${d.name} (optional)` : d.name,
      detail: d.limit,
      flagged: needsLook(d.confidence, d.needs_human),
    })),
    ...pack.requirements.eligibility.map((e) => ({
      key: `rule::${e.rule}`,
      label: e.rule,
      detail: null as string | null,
      flagged: needsLook(e.confidence, e.needs_human),
    })),
  ];

  return (
    <div className={styles.root} onClick={onClose}>
      <button type="button" aria-label="Close Application Pack" className={styles.scrim} onClick={onClose} />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={PACK_TITLE}
        className={styles.sheet}
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
          <div>
            <p className={styles.title}>{PACK_TITLE}</p>
            {pack.program.length > 0 && <p className={styles.subtitle}>{pack.program}</p>}
          </div>
          <button type="button" ref={closeRef} aria-label="Close Application Pack" className={styles.close} onClick={onClose}>
            <X size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        {rows.length > 0 && (
          <section aria-label="Checklist">
            <h3 className={styles.section}>Checklist</h3>
            <ul className={styles.checkList}>
              {rows.map((row) => (
                <li key={row.key}>
                  <label className={styles.checkRow}>
                    <input type="checkbox" checked={checked.has(row.key)} onChange={() => toggle(row.key)} />
                    <span>
                      {row.label}
                      {row.detail ? <span className={styles.checkDetail}> · {row.detail}</span> : null}
                      {row.flagged ? <span className={styles.portalMark}>{CHECK_AGAINST_PORTAL}</span> : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}

        {answers.length > 0 && (
          <section aria-label="Copy-ready answers">
            <h3 className={styles.section}>Copy-ready answers</h3>
            {answers.map((a) => (
              <article key={`${a.kind}::${a.title}`} className={styles.answerCard}>
                <p className={styles.answerTitle}>{a.title}</p>
                <p className={styles.answerBody}>{a.body}</p>
                <div className={styles.answerMeta}>
                  <span>
                    {wordCount(a.body)} words{a.kept ? ' · kept' : ''}
                  </span>
                  <CopyButton text={a.body} />
                </div>
              </article>
            ))}
          </section>
        )}

        {emails.length > 0 && (
          <section aria-label="Ready-to-send emails">
            <h3 className={styles.section}>Ready-to-send emails</h3>
            {emails.map((email) => (
              <article key={`${email.kind}::${email.title}`} className={styles.answerCard}>
                <p className={styles.answerTitle}>{email.title}</p>
                <p className={styles.answerBody}>{email.body}</p>
                <div className={styles.answerMeta}>
                  <span>
                    {wordCount(email.body)} words{email.kept ? ' · kept' : ''}
                  </span>
                  <CopyButton text={email.body} />
                </div>
              </article>
            ))}
          </section>
        )}

        {pack.portalUrl ? (
          <a href={pack.portalUrl} target="_blank" rel="noreferrer" className={styles.portalBtn}>
            Open the application page
          </a>
        ) : null}
      </div>
    </div>
  );
}
