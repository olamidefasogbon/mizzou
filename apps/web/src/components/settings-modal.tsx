'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { openReminderCount } from './panel-helpers';
import { SETTINGS_NAV, type SettingsSection } from './settings-sections';
import { useStore } from './store-context';
import { supabaseBrowser } from '@/lib/supabase/client';
import { upgradeToGoogle } from './google-upgrade';
import styles from './settings-modal.module.css';

// Settings dialog (P2-14). General / Help & support / Legal & safety on
// the left, Log out at the bottom of the nav, close button top-right,
// Esc closes. Full-screen sheet under 768px.

type Section = SettingsSection;

const NAV = SETTINGS_NAV;

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { isGuest, name, email, reminders, clearChats, deleteMyData } = useStore();
  const [upgradeBusy, setUpgradeBusy] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  const upgrade = (): void => {
    if (upgradeBusy) return;
    setUpgradeBusy(true);
    setUpgradeError(null);
    void (async () => {
      const out = await upgradeToGoogle(supabaseBrowser().auth, window.location.origin);
      if ('url' in out) window.location.assign(out.url);
      else {
        setUpgradeError(out.error);
        setUpgradeBusy(false);
      }
    })();
  };
  const [section, setSection] = useState<Section>('general');
  const [deleted, setDeleted] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !rootRef.current) return;
      const items = [...rootRef.current.querySelectorAll<HTMLElement>('button, a[href], input')].filter(
        (el) => !el.hasAttribute('disabled'),
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const activeReminders = openReminderCount(reminders);

  return createPortal(
    <div className={styles.scrim} onClick={onClose}>
      <div
        className={styles.dialog}
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <button ref={closeRef} type="button" aria-label="Close settings" className={styles.closeBtn} onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <nav className={styles.nav} aria-label="Settings sections">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={section === item.id ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
              aria-current={section === item.id ? 'page' : undefined}
              onClick={() => setSection(item.id)}
            >
              {item.label}
            </button>
          ))}
          <span className={styles.navSpacer} />
          <button
            type="button"
            className={styles.navItem}
            onClick={() => {
              onClose();
              void supabaseBrowser()
                .auth.signOut()
                .finally(() => router.push('/'));
            }}
          >
            Log out
          </button>
        </nav>
        <div className={styles.body}>
          {section === 'general' ? (
            <>
              <p className={styles.heading}>Account</p>
              {isGuest ? (
                <>
                  <div className={styles.accountCard}>
                    <span aria-hidden="true" className={styles.avatar}>?</span>
                    <span className={styles.accountText}>
                      <span className={styles.accountName}>Guest</span>
                      <span className={styles.accountSub}>Continue with Google to keep chats and sync Calendar</span>
                    </span>
                  </div>
                  <button type="button" className={`${styles.linkRow} ${styles.linkButton}`} onClick={upgrade} disabled={upgradeBusy}>
                    {upgradeBusy ? 'Connecting…' : 'Save your chats, continue with Google'}
                  </button>
                  {upgradeError ? (
                    <p className={styles.helpLine} role="alert">
                      {upgradeError}
                    </p>
                  ) : null}
                </>
              ) : (
                <div className={styles.accountCard}>
                  <span aria-hidden="true" className={styles.avatar}>
                    {(name ?? email ?? '?').slice(0, 1).toUpperCase()}
                  </span>
                  <span className={styles.accountText}>
                    <span className={styles.accountName}>{name ?? email ?? 'Signed in'}</span>
                    <span className={styles.accountSub}>{email ?? 'Signed in with Google'}</span>
                  </span>
                </div>
              )}
              <div className={styles.kvRow}>
                <span>Calendar (.ics export)</span>
                <span className={styles.kvValue}>Ready</span>
              </div>
              <div className={styles.kvRow}>
                <span>Active reminders</span>
                <span className={styles.kvValue}>{activeReminders}</span>
              </div>
              <button type="button" className={styles.dangerRow} onClick={() => void clearChats()}>
                Clear all chats
              </button>
            </>
          ) : null}
          {section === 'help' ? (
            <>
              <p className={styles.heading}>Help &amp; support</p>
              <p className={styles.helpLine}>Paste a program link in any chat and Mizzou reads what they ask for.</p>
              <p className={styles.helpLine}>Approve each step — nothing happens without your yes.</p>
              <p className={styles.helpLine}>Download the .ics file to put deadlines on your calendar.</p>
              <a className={styles.linkRow} href="mailto:feedback@mizzou.app">
                Send feedback
              </a>
            </>
          ) : null}
          {section === 'legal' ? (
            <>
              <p className={styles.heading}>Legal &amp; safety</p>
              <p className={styles.legalTitle}>Terms</p>
              <p className={styles.legalText}>
                Use Mizzou for your own applications. Don&apos;t paste anyone else&apos;s private information into chats.
              </p>
              <p className={styles.legalTitle}>Privacy</p>
              <p className={styles.legalText}>
                No signup required: guests are anonymous. An optional Google account only tells us who you are. Your chats, reminders, saved runs, and daily spend live in
                your own Supabase project.
              </p>
              <p className={styles.legalTitle}>Delete my data</p>
              {deleted ? (
                <p className={styles.helpLine} role="status">
                  Deleted your chats and reminders.
                </p>
              ) : (
                <button
                  type="button"
                  className={styles.dangerRow}
                  onClick={() => {
                    void deleteMyData().then(() => setDeleted(true));
                  }}
                >
                  Delete my chats and reminders
                </button>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
