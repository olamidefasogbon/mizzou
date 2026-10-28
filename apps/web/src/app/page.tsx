import Link from "next/link";
import styles from "./landing.module.css";

// Landing. Matched file: docs/design/html/Main.html (values copied exactly).

export default function LandingPage() {
  return (
    <div className="mz-shell">
      <div className={styles.screen} style={{ minHeight: "100dvh" }}>
        <div className={styles.blob1} aria-hidden="true" />
        <div className={styles.blob2} aria-hidden="true" />
        <div className={styles.blob3} aria-hidden="true" />

        <div className={styles.hero}>
          <div className={`mz-wordmark ${styles.wordmark}`}>Mizzou</div>
          <p className={styles.headline}>From link to executed application.</p>
          <div className={`mz-glass ${styles.pill}`}>You approve every step</div>
        </div>

        <div className={styles.cta}>
          <Link href="/signup" className={`mz-btn mz-btn-primary ${styles.tryButton}`}>
            Try it for free
          </Link>
          <p className={styles.loginLine}>
            Already have an account?{" "}
            <Link href="/signup" className={styles.loginLink}>
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
