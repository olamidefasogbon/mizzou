'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Search, Settings, SquarePen, X } from 'lucide-react';
import { useStore } from './store-context';
import { supabaseBrowser } from '@/lib/supabase/client';
import { upgradeToGoogle } from './google-upgrade';
import { groupChatsByRecency } from '@/lib/chat-groups';
import {
  activeChatIdFromPath,
  dedupeReminders,
  newChatHref,
  reminderQuestion,
  filterPanelChats,
  filterPanelReminders,
  openReminderCount,
} from './panel-helpers';
import { SettingsModal } from './settings-modal';
import styles from './panel.module.css';

// Left panel drawer. Contents in order: New chat, search, Reminders, Chats
// grouped by recency, Clear all + Undo, footer with avatar, name/email and
// the settings icon. The wordmark sits top left in the same spot as the top
// bar's, which hides while the panel is open.

export function Panel({
  onNavigate,
  onDismiss,
  onClose,
  section,
}: {
  onNavigate: () => void;
  /** Close the panel only; the caller navigates itself. */
  onDismiss: () => void;
  onClose: () => void;
  /** Home "See all" opens the panel scrolled to this section. */
  section?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const activeId = activeChatIdFromPath(pathname);
  const { isGuest, name, email, reminders, chats, clearChats, undoClearChats, undoArmed, expireUndo } = useStore();
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

  const visibleReminders = dedupeReminders(filterPanelReminders(reminders, query));
  const visibleChats = filterPanelChats(chats, query);
  const groups = groupChatsByRecency(visibleChats);
  const openChat = (id: string): void => {
    onDismiss();
    router.push(`/app/c/${id}`);
  };

  // A tapped reminder opens a fresh chat that asks about that program.
  const openReminder = (r: (typeof reminders)[number]): void => {
    onDismiss();
    router.push(newChatHref(reminderQuestion(r), crypto.randomUUID()));
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
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className={styles.drawer} ref={rootRef} tabIndex={-1}>
      <div className={styles.topRow}>
        <div className={`mz-wordmark ${styles.wordmark}`} aria-hidden="true">
          Mizzou
        </div>
        <button type="button" aria-label="Close menu" data-autofocus="true" className={styles.roundBtn} onClick={onClose}>
          <X size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <button
        type="button"
        className={styles.newChatRow}
        onClick={onNavigate}
      >
        <SquarePen size={20} strokeWidth={1.75} aria-hidden="true" />
        <span className={styles.newChatLabel}>New chat</span>
      </button>

      <div className={styles.searchRow}>
        <Search size={16} strokeWidth={1.75} className={styles.searchIcon} aria-hidden="true" />
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
            <button key={r.id} type="button" className={styles.reminderRow} onClick={() => openReminder(r)}>
              <span className={styles.reminderText}>
                <span className={styles.reminderTitle}>{r.title}</span>
                <span className={styles.reminderSub}>{r.sub}</span>
              </span>
              <span className={`mz-pill ${styles.reminderPill}`}>{r.pill}</span>
            </button>
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
          <span>Chats cleared</span>
          <button type="button" className={styles.undoButton} onClick={() => void undoClearChats()}>
            Undo
          </button>
        </div>
      ) : null}

      <div className={styles.spacer} />

      <div className={styles.footer}>
        <span aria-hidden="true" className={styles.avatar}>
          {isGuest ? '?' : (name ?? email ?? '?').slice(0, 1).toUpperCase()}
        </span>
        {isGuest ? (
          <span className={styles.userText}>
            <span className={styles.userName}>Guest</span>
            <button type="button" className={styles.saveLink} onClick={upgrade} disabled={upgradeBusy}>
              {upgradeBusy ? 'Connecting…' : 'Save your chats, continue with Google'}
            </button>
            {upgradeError ? <span className={styles.userSub}>{upgradeError}</span> : null}
          </span>
        ) : (
          <span className={styles.userText}>
            <span className={styles.userName}>{name ?? email ?? 'Signed in'}</span>
            <span className={styles.userSub}>{email ?? 'Signed in with Google'}</span>
          </span>
        )}
        <button
          type="button"
          aria-label="Open settings"
          className={styles.gearBtn}
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      {settingsOpen ? <SettingsModal onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}
