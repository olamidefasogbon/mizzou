'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Blobs, Composer } from '@/components/chrome';
import { useStore } from '@/components/store-context';
import styles from './home.module.css';

// Home. Matched files: docs/design/html/Chat.html (greeting, Coming up,
// composer) and docs/design/html/PlusMenu.html (upload overlay, in chrome).
// Greeting and Coming up render only real store rows: a fresh browser sees
// "Howdy" and an empty card. No demo data in app code.

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

export default function HomeClient() {
  const router = useRouter();
  const { name, reminders } = useStore();
  const [wordIndex, setWordIndex] = useState(0);
  const [wordVisible, setWordVisible] = useState(true);
  const [input, setInput] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickedFile, setPickedFile] = useState<string | null>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => {
      setWordVisible(false);
      setTimeout(() => {
        setWordIndex((i) => (i + 1) % ROTATING_WORDS.length);
        setWordVisible(true);
      }, 260);
    }, 2800);
    return () => clearInterval(timer);
  }, []);

  const send = () => {
    const text = input.trim();
    if (!text) return;
    // Hand the message to a fresh chat; the conversation screen posts it.
    router.push(`/app/c/${crypto.randomUUID()}?q=${encodeURIComponent(text)}`);
  };

  return (
    <>
      <Blobs
        specs={[
          { top: -80, right: -100, size: 300, color: 'var(--mz-blob-1)', blur: 60 },
          { top: 280, left: -120, size: 280, color: 'var(--mz-blob-2)', blur: 60 },
          { bottom: 120, right: -110, size: 320, color: 'var(--mz-blob-3)', blur: 70 },
        ]}
      />
      <div className={styles.body}>
        <div className={styles.greeting}>
          <p className={styles.hello}>{name ? `Howdy, ${name}` : 'Howdy'}</p>
          <p className={styles.rotating}>
            What{' '}
            <span className={`mz-fade ${styles.rotatingWord}`} style={{ opacity: wordVisible ? 1 : 0 }}>
              {ROTATING_WORDS[wordIndex]}
            </span>{' '}
            are you applying for today?
          </p>
        </div>

        <div className={`mz-glass ${styles.comingUp}`}>
          <div className={styles.comingUpHead}>
            <span className={styles.comingUpTitle}>Coming up</span>
            <span className={styles.seeAll}>See all</span>
          </div>
          {reminders.length === 0 ? (
            <p className={styles.emptyNote}>Nothing on your radar yet. Send me an admissions link and I&rsquo;ll watch every date.</p>
          ) : (
            reminders.slice(0, 3).map((row) => (
              <div key={row.id} className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.rowTitle}>{row.title}</span>
                  <span className={styles.rowSub}>{row.sub}</span>
                </div>
                <span className={`mz-pill ${styles.rowPill}`}>{row.pill}</span>
              </div>
            ))
          )}
        </div>
        {pickedFile ? <p className={styles.pickedFile}>Attached: {pickedFile} (upload sends in M7)</p> : null}
      </div>

      <Composer
        value={input}
        onChange={setInput}
        onSend={send}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((v) => !v)}
        onPick={(f) => {
          setPickedFile(f.name);
          setMenuOpen(false);
        }}
      />
    </>
  );
}
