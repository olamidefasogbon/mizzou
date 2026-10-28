'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from './store-context';
import styles from './panel.module.css';

// Left panel drawer + log-out modal. Matched files: docs/design/html/Panel.html
// (drawer) and docs/design/html/Logout.html (modal). Lists render only real
// store rows: empty until reminders/chats exist. No demo data in app code.

export function Panel({ onNavigate }: { onNavigate: () => void }) {
  const router = useRouter();
  const { name, reminders, chats, clearChats, undoClearChats, undoArmed, expireUndo } = useStore();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!undoArmed) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => expireUndo(), 5000);
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    };
  }, [undoArmed, expireUndo]);

  return (
    <div className={styles.drawer}>
      <div className={styles.topRow}>
        <div className={`mz-wordmark ${styles.wordmark}`}>Mizzou</div>
        <button
          type="button"
          aria-label="New chat"
          className={styles.roundBtn}
          onClick={() => {
            onNavigate();
            router.push('/app');
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5H8.5A3.5 3.5 0 005 8.5v7A3.5 3.5 0 008.5 19h7a3.5 3.5 0 003.5-3.5V12M17.5 4.5a1.8 1.8 0 012.5 2.5L12 15l-3.5.5L9 12z" />
          </svg>
        </button>
      </div>

      <div className={styles.sectionRow}>
        <span className={styles.sectionLabel}>Reminders</span>
        <span className={styles.countBadge}>{reminders.filter((r) => !r.done).length}</span>
      </div>

      <div className={styles.card}>
        {reminders.length === 0 ? (
          <p className={styles.emptyNote}>No reminders yet.</p>
        ) : (
          reminders.map((r) => (
            <div key={r.id}>
              <div className={styles.reminderRow}>
                <div className={styles.reminderText}>
                  <span className={styles.reminderTitle}>{r.title}</span>
                  <span className={styles.reminderSub}>{r.sub}</span>
                </div>
                <span className={`mz-pill ${styles.reminderPill}`}>{r.pill}</span>
              </div>
              <div className="mz-divider" />
            </div>
          ))
        )}
      </div>

      <div className={styles.sectionRowTight}>
        <span className={styles.sectionLabel}>Chats</span>
        <button type="button" className={styles.clearAll} onClick={() => void clearChats()}>
          Clear all
        </button>
      </div>

      <div className={styles.chatList}>
        {chats.length === 0 && !undoArmed ? (
          <p className={styles.emptyNote}>No chats yet.</p>
        ) : (
          chats.map((c, i) => (
            <div key={c.id} className={i === 0 ? styles.chatActive : styles.chatRow}>
              {c.title}
            </div>
          ))
        )}
      </div>
      {undoArmed ? (
        <div className={styles.undoToast} role="status">
          <span>Chats cleared.</span>
          <button type="button" className={styles.undoButton} onClick={() => void undoClearChats()}>
            Undo
          </button>
        </div>
      ) : null}

      <div className={styles.spacer} />

      <div className={styles.bottomCard}>
        <button type="button" className={styles.settingsRow} onClick={() => {}}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3h0a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5h0a1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9v0a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
          </svg>
          <span className={styles.settingsLabel}>Settings</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#48484A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <div className="mz-divider" style={{ margin: "0 6px" }} />
        <button type="button" className={styles.userRow} onClick={() => setLogoutOpen(true)}>
          {name ? (
            <span aria-hidden="true" className={styles.avatar}>
              {name.slice(0, 1).toUpperCase()}
            </span>
          ) : (
            <span aria-hidden="true" className={styles.avatar}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#48484A" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="3.5" />
                <path d="M5 19a7 7 0 0114 0" />
              </svg>
            </span>
          )}
          <span className={styles.userText}>
            <span className={styles.userName}>{name ?? 'Guest'}</span>
            <span className={styles.userSub}>{name ? 'Signed in with Google' : 'Browsing as a guest'}</span>
          </span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#48484A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 14l5 5 5-5M7 10l5-5 5-5" />
          </svg>
        </button>
      </div>

      {logoutOpen && mounted
        ? createPortal(
            <div className={styles.modalScrim} onClick={() => setLogoutOpen(false)}>
          <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Log out of Mizzou?" onClick={(e) => e.stopPropagation()}>
            <p className={styles.modalTitle}>Log out of Mizzou?</p>
            <p className={styles.modalSub}>Your chats and reminders stay saved for when you come back.</p>
            <button
              type="button"
              className={`mz-btn mz-btn-primary ${styles.modalButton}`}
              onClick={() => {
                setLogoutOpen(false);
                onNavigate();
                router.push('/');
              }}
            >
              Log out
            </button>
            <button type="button" className={`mz-btn mz-btn-secondary ${styles.modalButton}`} onClick={() => setLogoutOpen(false)}>
              Cancel
            </button>
          </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
