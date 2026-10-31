import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import styles from "../legal.module.css";

export const metadata = { title: "Privacy · Mizzou" };

export default function PrivacyPage() {
  return (
    <div className="mz-shell">
      <main className={`mz-fg ${styles.page}`}>
        <div className={styles.column}>
          <Link href="/" aria-label="Back" className={`mz-icon-btn ${styles.back}`}>
            <ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" />
          </Link>
          <h1 className={styles.title}>Privacy</h1>
          <p className={styles.updated}>Last updated 31 October 2026</p>

          <h2 className={styles.heading}>What we receive</h2>
          <p className={styles.text}>
            You can use Mizzou as a guest with no account: we create an anonymous session with no name or email.
            If you choose to continue with Google, we receive your name and email address, and nothing else from
            your Google account.
          </p>

          <h2 className={styles.heading}>What we store</h2>
          <p className={styles.text}>
            Your chats, reminders, saved runs and daily usage are stored in Mizzou&apos;s database so your work is
            there when you come back.
          </p>

          <h2 className={styles.heading}>Who processes your messages</h2>
          <p className={styles.text}>
            To answer you, Mizzou sends your messages and the text of the pages it reads to Meta&apos;s model API.
          </p>

          <h2 className={styles.heading}>Deleting your data</h2>
          <p className={styles.text}>
            In Settings, under Legal and safety, you can delete your chats and reminders at any time.
          </p>
        </div>
      </main>
    </div>
  );
}
