import Link from "next/link";
import styles from "./signup.module.css";

// Sign-up. Matched file: docs/design/html/SignUp.html (values copied exactly).
// Both buttons enter as guest until Google OAuth is wired (plan item 1):
// the design routes both to the home screen.

export default function SignupPage() {
  return (
    <div className="mz-shell">
      <div className={styles.screen} style={{ minHeight: "100dvh" }}>
        <div className={styles.blob1} aria-hidden="true" />
        <div className={styles.blob2} aria-hidden="true" />
        <div className={styles.blob3} aria-hidden="true" />

        <Link href="/" aria-label="Back" className={`mz-glass mz-icon-btn ${styles.back}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </Link>

        <div className={`mz-glass ${styles.card}`}>
          <div className={`mz-wordmark ${styles.wordmark}`}>Mizzou</div>
          <p className={styles.heading}>Let&apos;s get you started.</p>
          <p className={styles.sub}>One tap with Google and we can start on your first application.</p>
          <Link href="/app" className={`mz-btn mz-btn-primary ${styles.googleButton}`}>
            Continue with Google
          </Link>
          <Link href="/app" className={`mz-btn mz-btn-secondary ${styles.guestButton}`}>
            Look around as a guest
          </Link>
        </div>

        <p className={styles.footer}>By continuing you agree to the terms and the privacy policy.</p>
      </div>
    </div>
  );
}
