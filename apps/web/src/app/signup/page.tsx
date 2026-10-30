import { Suspense } from "react";
import Link from "next/link";
import styles from "./signup.module.css";
import { SignupActions } from "./signup-actions";

// Sign-up. Meta.ai style: white canvas, blue primary, black text.
// Tablet and desktop per docs/design/UI_CORRECTIONS.md section 5:
// one responsive tree, no per-device copies.
// Both buttons sign in through Supabase: Google OAuth (or an in-place
// upgrade for anonymous guests) and anonymous guest sign-in.

export default function SignupPage() {
  return (
    <div className="mz-shell">
      <div className={`mz-fg ${styles.screen}`}>
        <Link href="/" aria-label="Back" className={`mz-icon-btn ${styles.back}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </Link>

        <div className={styles.intro}>
          <div className={`mz-wordmark ${styles.introWordmark}`}>Mizzou</div>
          <p className={styles.introHeadline}>From link to executed application.</p>
        </div>

        <div className={styles.side}>
          <div className={styles.card}>
            <div className={`mz-wordmark ${styles.wordmark}`}>Mizzou</div>
            <p className={styles.heading}>Let&apos;s get you started.</p>
            <p className={styles.sub}>One tap with Google and we can start on your first application.</p>
            <Suspense>
              <SignupActions
                googleClass={`mz-btn mz-btn-primary ${styles.googleButton}`}
                guestClass={`mz-btn mz-btn-secondary ${styles.guestButton}`}
              />
            </Suspense>
          </div>

          <p className={styles.footer}>By continuing you agree to the terms and the privacy policy.</p>
        </div>
      </div>
    </div>
  );
}
