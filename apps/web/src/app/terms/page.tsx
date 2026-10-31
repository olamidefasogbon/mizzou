import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import styles from "../legal.module.css";

export const metadata = { title: "Terms · Mizzou" };

export default function TermsPage() {
  return (
    <div className="mz-shell">
      <main className={`mz-fg ${styles.page}`}>
        <div className={styles.column}>
          <Link href="/" aria-label="Back" className={`mz-icon-btn ${styles.back}`}>
            <ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" />
          </Link>
          <h1 className={styles.title}>Terms</h1>
          <p className={styles.updated}>Last updated 31 October 2026</p>

          <h2 className={styles.heading}>What Mizzou is</h2>
          <p className={styles.text}>
            Mizzou helps you find and prepare for opportunities such as scholarships, programs, jobs and
            fellowships. It reads official pages, pulls out dates and requirements, and drafts reminders and
            materials for you to review.
          </p>

          <h2 className={styles.heading}>Check the official source</h2>
          <p className={styles.text}>
            Mizzou can misread a page or miss a change. Each date and requirement comes with the quote it was
            read from. Confirm anything important on the official site before you rely on it or submit.
          </p>

          <h2 className={styles.heading}>Advice only, your decisions</h2>
          <p className={styles.text}>
            Any fit read is advice, not a prediction or a guarantee. Mizzou does not submit applications or add
            anything to your calendar without your approval.
          </p>

          <h2 className={styles.heading}>Using it</h2>
          <p className={styles.text}>
            Use Mizzou for your own applications. Do not paste other people&apos;s private information into chats.
            Usage limits may apply.
          </p>
        </div>
      </main>
    </div>
  );
}
