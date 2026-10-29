// Every user-facing string the agent emits (PROMPT.md section 8.3).
// Short sentences, first person, warm, no jargon, no emoji, no preaching.
// Status labels adapt to the opportunity at hand (section 5.4).

export const SAY_ON_IT = 'On it. Let me find the right page and see what they ask for.';
export const SAY_GOT_IT = "Got everything. Here's my honest read.";
export const SAY_PAGE_WOULD_NOT_OPEN = 'That page wouldn\u2019t open for me. Can you paste the text?';
export const SAY_BUDGET_HIT = 'I need a minute.';
export const sayLanguageRead = (language: string): string => `I read this page in ${language}.`;

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
