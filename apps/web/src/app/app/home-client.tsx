'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Composer } from '@/components/chrome';
import { useStore } from '@/components/store-context';
import { DISMISS_COOKIE, remindersVersion, shouldShowComingUp } from './coming-up';
import styles from './home.module.css';

// Home. Matched files: docs/design/html/Chat.html (greeting, Coming up,
// composer) and docs/design/html/PlusMenu.html (upload overlay, in chrome).
// Greeting uses the first name only; a fresh browser sees "Howdy" and no
// Coming up card. No demo data in app code. No attachment control: uploads
// are not wired.
//
// Coming up (docs/design/UI_CORRECTIONS.md section 3): renders only when at
// least one reminder exists. The dismissal version arrives as a prop, read
// from the request cookie before first paint, so the card never renders
// then hides. A new or newly-due reminder changes the version, so the card
// returns.

const ROTATING_WORDS = [
  'scholarships',
  'universities',
  'PhD programs',
  'jobs',
  'fellowships',
  'internships',
  'research grants',
  'graduate programs',
  'exchange programs',
  'conferences',
];

export default function HomeClient({ dismissedServer }: { dismissedServer: string | null }) {
  const router = useRouter();
  const { name, reminders } = useStore();
  const [wordIndex, setWordIndex] = useState(0);
  const [wordVisible, setWordVisible] = useState(true);
  const [input, setInput] = useState('');
  const firstName = name?.trim().split(/\s+/)[0] ?? '';
  const typing = input.trim().length > 0;
  // Known before first paint: the server read it from the request cookie.
  const [dismissed, setDismissed] = useState<string | null>(dismissedServer);

  useEffect(() => {
    // The word rotates only while the box is empty and motion is welcome.
    if (typing || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => {
      setWordVisible(false);
      setTimeout(() => {
        setWordIndex((i) => (i + 1) % ROTATING_WORDS.length);
        setWordVisible(true);
      }, 260);
    }, 2800);
    return () => clearInterval(timer);
  }, [typing]);

  const send = () => {
    const text = input.trim();
    if (!text) return;
    // Hand the message to a fresh chat; the conversation screen posts it.
    router.push(`/app/c/${crypto.randomUUID()}?q=${encodeURIComponent(text)}`);
  };

  const version = useMemo(() => remindersVersion(reminders), [reminders]);
  const showComingUp = useMemo(() => shouldShowComingUp(reminders, dismissed), [reminders, dismissed]);

  const dismissComingUp = () => {
    try {
      document.cookie = `${DISMISS_COOKIE}=${encodeURIComponent(version)}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {
      // Cookie unavailable: dismissal lasts for this view only.
    }
    setDismissed(version);
  };

  const openPanelAtReminders = () => {
    window.dispatchEvent(new CustomEvent('mz:open-panel', { detail: { section: 'reminders' } }));
  };

  return (
    <>
      <div className={styles.body}>
        <div className={styles.greeting}>
          <p className={styles.hello}>{firstName ? `Howdy, ${firstName}` : 'Howdy'}</p>
          <p className={styles.rotating}>
            What{' '}
            <span className={`mz-fade ${styles.rotatingWord}`} style={{ opacity: wordVisible ? 1 : 0 }}>
              {ROTATING_WORDS[wordIndex]}
            </span>{' '}
            are you applying for today?
          </p>
        </div>

        {showComingUp ? (
          <div key={version} className={styles.comingUp}>
            <div className={styles.comingUpHead}>
              <span className={styles.comingUpTitle}>Coming up</span>
              <span className={styles.comingUpActions}>
                <button type="button" className={styles.seeAll} onClick={openPanelAtReminders}>
                  See all
                </button>
                <button type="button" aria-label="Dismiss Coming up" className={styles.comingUpClose} onClick={dismissComingUp}>
                  <X size={20} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </span>
            </div>
            {reminders.slice(0, 3).map((row) => (
              <div key={row.id} className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.rowTitle}>{row.title}</span>
                  <span className={styles.rowSub}>{row.sub}</span>
                </div>
                <span className={`mz-pill ${styles.rowPill}`}>{row.pill}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className={styles.composer}>
        <Composer value={input} onChange={setInput} onSend={send} />
      </div>
    </>
  );
}
