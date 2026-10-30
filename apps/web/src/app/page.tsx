import Link from "next/link";
import styles from "./landing.module.css";

// Landing. Meta.ai style: white canvas, blue primary, black text.
// Tablet and desktop per docs/design/UI_CORRECTIONS.md section 5:
// one responsive tree, no per-device copies.

const CARDS: Array<[string, string]> = [
  [
    "Tell me what you want",
    "Start with a link to the program, or describe what you are chasing.",
  ],
  [
    "I read the whole official site",
    "Dates and requirements come with the exact quote they were read from.",
  ],
  [
    "You approve every step",
    "Nothing moves without your yes: the program, your profile, every draft.",
  ],
];

export default function LandingPage() {
  return (
    <div className="mz-shell">
      <div className={`mz-fg ${styles.screen}`}>
        <div className={styles.lead}>
          <div className={styles.hero}>
            <div className={`mz-wordmark ${styles.wordmark}`}>Mizzou</div>
            <p className={styles.headline}>From link to executed application.</p>
          </div>

          <div className={styles.cta}>
            <Link href="/signup" className={`mz-btn mz-btn-primary ${styles.tryButton}`}>
              Try it for free
            </Link>
            <p className={styles.loginLine}>
              <span>Already have an account? </span>
              <Link href="/signup" className={styles.loginLink}>
                Log in
              </Link>
            </p>
          </div>
        </div>

        <div className={styles.cards}>
          {CARDS.map(([title, body]) => (
            <div key={title} className={styles.card}>
              <p className={styles.cardTitle}>{title}</p>
              <p className={styles.cardBody}>{body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
