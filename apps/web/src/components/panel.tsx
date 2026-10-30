'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useStore } from './store-context';
import { groupChatsByRecency } from '@/lib/chat-groups';
import {
  activeChatIdFromPath,
  filterPanelChats,
  filterPanelReminders,
  openReminderCount,
} from './panel-helpers';
import { SettingsModal } from './settings-modal';
import styles from './panel.module.css';

// Left panel drawer. Contents in order: New chat, search, Reminders, Chats
// grouped by recency, Clear all + Undo, footer with avatar, name/email and
// the settings icon. No wordmark (the top bar has it), no placeholder rows.

export function Panel({
  onNavigate,
  onClose,
  section,
}: {
  onNavigate: () => void;
  onClose: () => void;
  /** Home "See all" opens the panel scrolled to this section. */
  section?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const activeId = activeChatIdFromPath(pathname);
  const { name, email, reminders, chats, clearChats, undoClearChats, undoArmed, expireUndo } = useStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const remindersRef = useRef<HTMLDivElement | null>(null);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  // Focus trap: keep Tab inside the overlay, Esc closes, focus lands back
  // on the menu button via onClose. Skipped while the settings dialog owns
  // focus (it traps and closes itself).
  useEffect(() => {
    const root = rootRef.current;
    const closeBtn = root?.querySelector<HTMLElement>('[data-autofocus="true"]');
    (closeBtn ?? root)?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (settingsOpen) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>('button, a[href], input')].filter(
        (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
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
  }, [onClose, settingsOpen]);

  // Home "See all" lands the panel at Reminders.
  useEffect(() => {
    if (section !== 'reminders') return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    remindersRef.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [section]);

  useEffect(() => {
    if (!undoArmed) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => expireUndo(), 5000);
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    };
  }, [undoArmed, expireUndo]);

  const visibleReminders = filterPanelReminders(reminders, query);
  const visibleChats = filterPanelChats(chats, query);
  const groups = groupChatsByRecency(visibleChats);
  const openChat = (id: string): void => {
    onNavigate();
    router.push(`/app/c/${id}`);
  };

  const renderGroup = (label: string, list: typeof chats): React.JSX.Element | null => {
    if (list.length === 0) return null;
    return (
      <div key={label}>
        <div className={styles.groupLabelRow}>
          <span className={styles.sectionLabel}>{label}</span>
        </div>
        {list.map((c) => (
          <button
            key={c.id}
            type="button"
            className={activeId === c.id ? styles.chatActive : styles.chatRow}
            onClick={() => openChat(c.id)}
          >
            <span className={styles.chatTitle}>{c.title}</span>
            <svg className={styles.chatArrow} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className={styles.drawer} ref={rootRef} tabIndex={-1}>
      <div className={styles.topRow}>
        <button type="button" aria-label="Close menu" data-autofocus="true" className={styles.roundBtn} onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <button
        type="button"
        className={styles.newChatRow}
        onClick={() => {
          onNavigate();
          router.push('/app');
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 5H8.5A3.5 3.5 0 005 8.5v7A3.5 3.5 0 008.5 19h7a3.5 3.5 0 003.5-3.5V12M17.5 4.5a1.8 1.8 0 012.5 2.5L12 15l-3.5.5L9 12z" />
        </svg>
        <span className={styles.newChatLabel}>New chat</span>
      </button>

      <div className={styles.searchRow}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#48484A" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          type="search"
          aria-label="Search chats and reminders"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={styles.searchInput}
        />
      </div>

      <div className={styles.sectionRow} ref={remindersRef}>
        <span className={styles.sectionLabel}>Reminders</span>
        {openReminderCount(visibleReminders) > 0 ? (
          <span className={styles.countBadge}>{openReminderCount(visibleReminders)}</span>
        ) : null}
      </div>

      {visibleReminders.length > 0 ? (
        <div className={styles.card}>
          {visibleReminders.map((r) => (
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
          ))}
        </div>
      ) : null}

      <div className={styles.sectionRowTight}>
        <span className={styles.sectionLabel}>Chats</span>
        {chats.length > 0 ? (
          <button type="button" className={styles.clearAll} onClick={() => void clearChats()}>
            Clear all
          </button>
        ) : null}
      </div>

      <div className={styles.chatList}>
        {renderGroup('Today', groups.today)}
        {renderGroup('Previous 7 days', groups.previous7d)}
        {renderGroup('Older', groups.older)}
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

      <div className={styles.footer}>
        <span aria-hidden="true" className={styles.avatar}>
          {(name ?? email ?? '?').slice(0, 1).toUpperCase()}
        </span>
        <span className={styles.userText}>
          <span className={styles.userName}>{name ?? email ?? 'Signed in'}</span>
          <span className={styles.userSub}>{email ?? 'Signed in with Google'}</span>
        </span>
        <button
          type="button"
          aria-label="Open settings"
          className={styles.gearBtn}
          onClick={() => setSettingsOpen(true)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3h0a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5h0a1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9v0a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
          </svg>
        </button>
      </div>

      {settingsOpen ? <SettingsModal onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}
