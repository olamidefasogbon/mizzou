'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Composer } from '@/components/chrome';
import type { AttachState } from '@/components/attach-button';
import { downscaleImage, stashVision, uploadImage, type VisionPayload } from '@/components/attach-image';
import { useStore } from '@/components/store-context';
import { dedupeReminders, newChatHref, reminderQuestion } from '@/components/panel-helpers';
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
  const { name, reminders, markReminderDone, removeReminder, reminderUndo, clearedReminders, remindersUndoArmed, undoRemoveReminder, undoClearReminders, expireRemindersUndo, refreshReminders } = useStore();
  const [wordIndex, setWordIndex] = useState(0);
  const [wordVisible, setWordVisible] = useState(true);
  const [input, setInput] = useState('');
  // Flyer/screenshot attach (upload D): uploads through /api/upload,
  // then ships with the first message as a vision seed for G1.
  const [attach, setAttach] = useState<AttachState>({ status: 'idle' });
  const [vision, setVision] = useState<VisionPayload | null>(null);
  const [attaching, setAttaching] = useState(false);
  // Sent while the picture was still being read: ships as soon as it is.
  const [queued, setQueued] = useState(false);
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

  const pickImage = (file: File): void => {
    if (attaching) return;
    setAttaching(true);
    setAttach({ status: 'uploading', name: file.name.slice(0, 60) });
    void (async () => {
      try {
        const dataUrl = await downscaleImage(file);
        const payload = await uploadImage(dataUrl, file.name.slice(0, 120));
        setVision(payload);
        setAttach({ status: 'ready', name: payload.name });
      } catch (err) {
        setVision(null);
        setAttach({
          status: 'error',
          message: err instanceof Error ? err.message : 'I could not read that image. Try again in a moment.',
        });
      } finally {
        setAttaching(false);
      }
    })();
  };

  const removeImage = (): void => {
    setVision(null);
    setAttach({ status: 'idle' });
  };

  const send = () => {
    if (attaching) {
      if (input.trim()) setQueued(true);
      return;
    }
    let text = input.trim();
    if (!text && !vision) return;
    if (!text && vision) text = `I attached ${vision.name}. What is it?`;
    // Hand the message to a fresh chat; the conversation screen posts it.
    // A vision seed travels in session storage, consumed once on arrival.
    const id = crypto.randomUUID();
    if (vision) stashVision(id, [vision]);
    router.push(`/app/c/${id}?q=${encodeURIComponent(text)}`);
  };

  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (!queued || attaching) return;
    setQueued(false);
    // A failed read keeps the text in the box and shows the error instead.
    if (attach.status !== 'error') sendRef.current();
  }, [queued, attaching, attach.status]);

  const version = useMemo(() => remindersVersion(reminders), [reminders]);
  const showComingUp = useMemo(() => shouldShowComingUp(reminders, dismissed), [reminders, dismissed]);

  useEffect(() => {
    if (!remindersUndoArmed) return;
    const timer = setTimeout(() => expireRemindersUndo(), 5000);
    return () => clearTimeout(timer);
  }, [remindersUndoArmed, expireRemindersUndo]);

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
            {remindersUndoArmed ? (
            <div className={styles.row} role="status">
              <span className={styles.rowText}>
                <span className={styles.rowTitle}>{clearedReminders ? 'Reminders cleared' : `Removed ${reminderUndo?.title ?? 'reminder'}`}</span>
              </span>
              <button
                type="button"
                className={styles.rowAction}
                onClick={() => void (clearedReminders ? undoClearReminders() : undoRemoveReminder()).catch(() => void refreshReminders())}
              >
                Undo
              </button>
            </div>
          ) : null}
          {dedupeReminders(reminders).slice(0, 3).map((row) => (
            <div key={row.id} className={styles.row}>
              <button
                type="button"
                className={styles.rowOpen}
                aria-label={`Open a chat about ${row.title}`}
                onClick={() => router.push(newChatHref(reminderQuestion(row), crypto.randomUUID()))}
              >
                <span className={styles.rowText}>
                  <span className={styles.rowTitle}>{row.title}</span>
                  <span className={styles.rowSub}>{row.sub}</span>
                </span>
                <span className={`mz-pill ${styles.rowPill}`}>{row.pill}</span>
              </button>
              <button
                type="button"
                className={styles.rowAction}
                aria-label={`Mark ${row.title} done`}
                onClick={() => void markReminderDone(row.id).catch(() => void refreshReminders())}
              >
                <Check size={16} strokeWidth={2} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={styles.rowAction}
                aria-label={`Remove ${row.title}`}
                onClick={() => void removeReminder(row.id).catch(() => void refreshReminders())}
              >
                <X size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          ))}
          </div>
        ) : null}
      </div>

      <div className={styles.composer}>
        <Composer
          value={input}
          onChange={setInput}
          onSend={send}
          attach={{ state: attach, disabled: attaching, onPick: pickImage, onRemove: removeImage, queued }}
          voice={{ onTranscript: (t) => setInput((v) => (v ? `${v} ${t}` : t)) }}
        />
      </div>
    </>
  );
}
