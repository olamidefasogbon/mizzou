// Every user-facing string the agent emits (PROMPT.md section 8.3).
// Short sentences, first person, warm, no jargon, no emoji, no preaching.
// Status labels adapt to the opportunity at hand (section 5.4).

export function formatCoverageRead(titles: string[]): string {
  if (titles.length === 0) return 'I could not open any page to read.';
  if (titles.length === 1) return `I read this page: ${titles[0]}.`;
  return `I read ${titles.length} pages: ${titles.join('; ')}.`;
}

/** Short step labels for the progress line (nouns, not sentences). */
export const STATUS_START = 'Finding the right page';
export const STATUS_DONE = 'Finished reading';
export const SAY_ON_IT = 'On it. Let me find the right page and see what they ask for.';
export const SAY_GOT_IT = "Got everything. Here's my honest read.";
export const SAY_PAGE_WOULD_NOT_OPEN = 'That page wouldn\u2019t open for me. Can you paste the text?';
export const SAY_BUDGET_HIT = 'I need a minute.';
export const SAY_STUCK = 'I ran out of steps on this one. Send the link again and I\u2019ll pick up where I left off.';
export const sayLanguageRead = (language: string): string => `I read this page in ${language}.`;

/**
 * Layout words the model must never use to describe cards. Cards always
 * render directly after the bubble that introduces them, so "above" and
 * "below" can only confuse. Case-insensitive whole-word match.
 */
export function hasLayoutReference(text: string): boolean {
  return /\b(above|below)\b/i.test(text);
}

/**
 * System words the voice never uses. Mizzou talks about the degree, the
 * cohort, the opening, the office — never about itself or its machinery.
 */
export function hasBannedTerm(text: string): boolean {
  return /\b(ai|assistant|chatbot|model|dashboard)\b/i.test(text);
}

/** Rolling-review notice for listings with no fixed closing date. */
export const ROLLING_NOTICE_TEXT =
  'No fixed closing date found on this listing. Applications may be reviewed on a rolling basis.';

export function formatFindingStatus(url: string): string {
  try {
    const domain = new URL(url).hostname.replace('www.', '');
    return `Finding page details on ${domain}`;
  } catch {
    return 'Finding the right page';
  }
}

export function formatReadingStatus(opportunityType: string, institutionName?: string): string {
  const target = institutionName || 'opportunity';
  switch (opportunityType) {
    case 'job':
      return `Reading ${target} job requirements`;
    case 'fellowship':
      return `Reading ${target} fellowship guidelines`;
    case 'grant':
    case 'scholarship':
      return `Reading ${target} funding criteria`;
    case 'competition':
    case 'hackathon':
      return `Reading ${target} submission guidelines`;
    case 'incubator':
      return `Reading ${target} cohort terms`;
    case 'academic_program':
    default:
      return `Reading ${target} admissions details`;
  }
}

export function formatG2Conflict(fields: string[]): string {
  if (fields.length === 1) return `Two official pages disagree on "${fields[0]}". Which one looks right to you?`;
  return `Two official pages disagree on ${fields.length} items (${fields.slice(0, 3).join('; ')}). Which ones look right to you?`;
}

/** "How you match up" fit card strings (PROMPT.md 7.2 + 8 screen 9). Code-emitted like the rolling notice: plain words only, never a number. */
export const FIT_CARD_TITLE = 'How you match up';
export const FIT_QUESTION = 'Want to go for it anyway?';
export const FIT_APPLY_LABEL = "Yes, let's apply";
export const FIT_PARK_LABEL = 'Not now';
/** Draft card + Application Pack strings (PROMPT.md 7.5, 7.6, 8 screen 10). */
export const DRAFT_EDIT_PLACEHOLDER = 'Tell me what to change, like "make it more academic"';
export const DRAFT_KEEP_LABEL = 'Keep';
export const PACK_TITLE = 'Application Pack';
export const PACK_OPEN_LABEL = 'View Application Pack';
export const CHECK_AGAINST_PORTAL = 'check against the portal';
/** Check-again reminder for an unpublished opening date (PROMPT.md 6.5). */
export const OPENING_CHECK_AGAIN = "Opening date isn't posted yet — I'll check again.";
/** Talk-back chips (PROMPT.md 7.4): the chat opens with a due reminder plus these three. */
export const TALKBACK_DONE_LABEL = 'Done';
export const TALKBACK_SNOOZE_LABEL = 'Snooze';
export const TALKBACK_HELP_LABEL = 'Help me';
export function formatDueMessage(title: string, sub: string, pill: string): string {
  return `${title} — ${sub} ${pill}.`;
}

export function formatG1Prompt(opportunityType: string): string {
  switch (opportunityType) {
    case 'job':
      return 'Quick check before I go further. Is this the position you mean?';
    case 'fellowship':
      return 'Quick check before I go further. Is this the fellowship you mean?';
    case 'grant':
    case 'scholarship':
      return 'Quick check before I go further. Is this the funding call you mean?';
    case 'competition':
    case 'hackathon':
      return 'Quick check before I go further. Is this the event or challenge you mean?';
    case 'incubator':
      return 'Quick check before I go further. Is this the cohort program you mean?';
    default:
      return 'Quick check before I go further. Is this what you mean?';
  }
}
