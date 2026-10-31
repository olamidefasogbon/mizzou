import Link from "next/link";
import { Check, Quote } from "lucide-react";
import styles from "./landing.module.css";
import { LoginButton, TryButton } from "./landing-actions";

// Landing. No signup: "Try it for free" opens the app straight away; "Log in" is
// a quiet text link for returning Google users. White canvas, centered hero,
// one blue primary button.
// The example program is fictional and labelled as an example.

const POINTS: Array<[string, string]> = [
  ["Tell me what you want", "Start with a link to the program, or describe what you are chasing."],
  ["I read the whole official site", "Dates and requirements come with the exact quote they were read from."],
  ["You approve every step", "Nothing moves without your yes: the program, your profile, every draft."],
];

const EXAMPLE_REQUIREMENTS = [
  "Official transcript · PDF",
  "Two reference letters",
  "Research statement · 1,000 words max",
];

export default function LandingPage() {
  return (
    <div className="mz-shell">
      <div className={`mz-fg ${styles.screen}`}>
        <header className={styles.topbar}>
          <LoginButton className="mz-link-quiet" />
        </header>

        <div className={styles.lead}>
          <div className={styles.hero}>
            <div className={`mz-wordmark ${styles.wordmark}`}>Mizzou</div>
            <h1 className={styles.headline}>From link to executed application</h1>
            <p className={styles.sub}>
              Your opportunity buddy. Tell me what you are going for and I handle the reading,
              the dates and the prep.
            </p>
          </div>

          <div className={styles.cta}>
            <TryButton className={`mz-btn mz-btn-primary ${styles.tryButton}`} />
          </div>
        </div>

        <figure className={styles.example} aria-label="Example of what Mizzou returns">
          <p className={styles.exampleLabel}>Example</p>
          <p className={styles.exampleTitle}>Northfield Graduate Fellowship</p>
          <p className={styles.exampleSub}>Northfield University • Graduate School</p>

          <p className={styles.exampleSection}>What they ask for</p>
          <ul className={styles.exampleList}>
            {EXAMPLE_REQUIREMENTS.map((r) => (
              <li key={r} className={styles.exampleItem}>
                <Check className={styles.exampleCheck} aria-hidden="true" />
                <span>{r}</span>
              </li>
            ))}
          </ul>

          <div className={styles.exampleDeadline}>
            <div className={styles.exampleDeadlineRow}>
              <span>Applications close</span>
              <span className={styles.exampleDate}>15 Jan 2027</span>
            </div>
            <p className={styles.exampleChip}>
              <Quote className={styles.exampleChipIcon} aria-hidden="true" />
              From the site
            </p>
            <blockquote className={styles.exampleQuote}>
              Applications close 15 January 2027 at 23:59 GMT.
            </blockquote>
          </div>
        </figure>

        <div className={styles.points}>
          {POINTS.map(([title, body]) => (
            <div key={title} className={styles.point}>
              <p className={styles.pointTitle}>{title}</p>
              <p className={styles.pointBody}>{body}</p>
            </div>
          ))}
        </div>

        <p className={styles.footer}>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
        </p>
      </div>
    </div>
  );
}
