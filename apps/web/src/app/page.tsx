import Link from "next/link";
import styles from "./landing.module.css";

// Landing. muse.ai pattern on Meta style: white canvas, everything centered,
// blue primary, black text. One wordmark, one primary button, one blue
// "Log in" pill top right. One responsive tree (UI_CORRECTIONS.md section 5).

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
        <header className={styles.topbar}>
          <Link href="/signup" className={`mz-btn mz-btn-primary ${styles.loginPill}`}>
            Log in
          </Link>
        </header>

        <div className={styles.lead}>
          <div className={styles.hero}>
            <div className={`mz-wordmark ${styles.wordmark}`}>Mizzou</div>
            <h1 className={styles.headline}>From link to executed application.</h1>
            <p className={styles.sub}>
              Your opportunity buddy. Tell me what you are going for and I handle the reading,
              the dates and the prep.
            </p>
          </div>

          <div className={styles.cta}>
            <Link href="/signup" className={`mz-btn mz-btn-primary ${styles.tryButton}`}>
              Try it for free
            </Link>
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
