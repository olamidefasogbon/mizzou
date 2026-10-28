'use client';

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Blobs, Composer, TopBar } from "@/components/chrome";
import styles from "./home.module.css";

// Home screen. Matched files: docs/design/html/Chat.html for the screen,
// docs/design/html/PlusMenu.html for the upload overlay (in chrome.tsx).
// Greeting name and Coming-up rows are fictional demo data (PROMPT.md 9.4);
// they come from the profile + reminders APIs in M7.

const ROTATING_WORDS = [
  "scholarships",
  "universities",
  "PhD programs",
  "jobs",
  "fellowships",
  "internships",
  "research grants",
  "graduate programs",
  "exchange programs",
  "conferences",
];

const COMING_UP = [
  { title: "Fulbright 2027", sub: "Statement of purpose, not finished", pill: "6 days" },
  { title: "Yale PhD, Food Science", sub: "Portal opens soon, I'm watching it", pill: "Soon" },
  { title: "Summer research internship", sub: "2 documents left", pill: "9 days" },
];

export default function HomeClient() {
  const router = useRouter();
  const [wordIndex, setWordIndex] = useState(0);
  const [wordVisible, setWordVisible] = useState(true);
  const [input, setInput] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickedFile, setPickedFile] = useState<string | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
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
    <div className="mz-shell">
      <Blobs
        specs={[
          { top: -80, right: -100, size: 300, color: "var(--mz-blob-1)", blur: 60 },
          { top: 280, left: -120, size: 280, color: "var(--mz-blob-2)", blur: 60 },
          { bottom: 120, right: -110, size: 320, color: "var(--mz-blob-3)", blur: 70 },
        ]}
      />
      {/* Panel drawer lands in the M8 UI pass; the button renders per design. */}
      <TopBar
        onMenu={() => {}}
        onNewChat={() => {
          setInput("");
          setMenuOpen(false);
        }}
      />

      <div className={styles.body}>
        <div className={styles.greeting}>
          <p className={styles.hello}>Howdy, John</p>
          <p className={styles.rotating}>
            What{" "}
            <span className={`mz-fade ${styles.rotatingWord}`} style={{ opacity: wordVisible ? 1 : 0 }}>
              {ROTATING_WORDS[wordIndex]}
            </span>{" "}
            are you applying for today?
          </p>
        </div>

        <div className={`mz-glass ${styles.comingUp}`}>
          <div className={styles.comingUpHead}>
            <span className={styles.comingUpTitle}>Coming up</span>
            <span className={styles.seeAll}>See all</span>
          </div>
          {COMING_UP.map((row) => (
            <div key={row.title} className={styles.row}>
              <div className={styles.rowText}>
                <span className={styles.rowTitle}>{row.title}</span>
                <span className={styles.rowSub}>{row.sub}</span>
              </div>
              <span className={`mz-pill ${styles.rowPill}`}>{row.pill}</span>
            </div>
          ))}
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
    </div>
  );
}
