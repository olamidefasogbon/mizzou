import type { ReconcilePage } from '../extract/reconcile.js';

// Case file (workflow ledger). Code only lists what is still unknown, from
// the persisted run state. The model decides how to close each gap, and
// reads, searches and asks on its own. Nothing here writes user-facing text.

export interface CaseFileInput {
  g1Confirmed: boolean;
  programUrl: string | null;
  pagesRead: number;
  unreadable: number;
  extractions: ReconcilePage[];
  profileFacts: number;
  now: Date;
}

export function buildCaseFile(input: CaseFileInput): string[] {
  const deadlines: number[] = [];
  let docs = 0;
  let rules = 0;
  for (const page of input.extractions) {
    for (const d of page.extraction.deadlines ?? []) {
      const iso = d.field?.value?.iso_utc;
      const t = iso ? Date.parse(iso) : Number.NaN;
      if (!Number.isNaN(t)) deadlines.push(t);
    }
    docs += page.extraction.documents?.length ?? 0;
    rules += page.extraction.eligibility?.length ?? 0;
  }
  const nowMs = input.now.getTime();
  const upcoming = deadlines.filter((t) => t > nowMs).length;
  const passed = deadlines.length - upcoming;

  const missing: string[] = [];
  if (!input.g1Confirmed) {
    missing.push('program not confirmed (if the user pasted the exact page URL, call resolve_gate with source user_supplied_url and continue; otherwise request_approval G1)');
  }
  if (input.pagesRead === 0) missing.push('no page read yet');
  if (input.pagesRead > 0 && deadlines.length === 0) {
    missing.push('no deadline found yet: read the apply, dates and FAQ pages yourself; if none of them states one, tell the user plainly and ask whether they still want to apply, want you to keep checking, or have the dates themselves');
  }
  if (deadlines.length > 0 && upcoming === 0) {
    missing.push('every deadline found has already passed: look for the next intake, or say none is posted');
  }
  if (input.pagesRead > 0 && docs === 0 && rules === 0) {
    missing.push('requirements not found yet: read the apply and eligibility pages');
  }
  if (input.profileFacts === 0) missing.push('no profile facts yet (ask one question when fit is the next step)');

  const known = [
    `pages read: ${input.pagesRead}`,
    `unreadable pages: ${input.unreadable}`,
    `deadlines found: ${deadlines.length} (${upcoming} upcoming, ${passed} passed)`,
    `documents: ${docs}, eligibility rules: ${rules}`,
  ];
  return [
    `Case file. Known: ${known.join('; ')}.`,
    missing.length > 0
      ? `Still missing: ${missing.join(' | ')}. Do every read-only item yourself now, in this turn. Only gates and questions need the user.`
      : 'Nothing essential is missing. Give the user the picture and the next step, then yield_to_user.',
  ];
}
