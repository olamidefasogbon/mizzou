import type { Extraction } from '@mizzou/core';

// Pure scoring helpers for the eval runner (no model calls, no I/O).
// deadlineHit preserves the baseline rule exactly: same UTC calendar day
// plus the expected label's first word appearing in the extracted label.

export const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

export const normDate = (s: string | null): string | null => {
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

export interface ExpectedDeadline {
  label: string;
  iso_utc: string;
}

export interface ExtractedDeadline {
  label: string;
  iso_utc: string | null;
}

export function deadlineHit(extracted: ExtractedDeadline[], expected: ExpectedDeadline): boolean {
  const wantDay = normDate(expected.iso_utc);
  const wantWord = norm(expected.label).split(' ')[0];
  return extracted.some((d) => normDate(d.iso_utc) === wantDay && norm(d.label).includes(wantWord));
}

export interface ExtractedDeadlineSummary {
  label: string;
  iso_utc: string | null;
  evidence_quote: string;
  checked: boolean;
}

// Minimal raw record persisted per case so a 0/1 deadline score can be
// audited later without re-running the model.
export function summarizeDeadlines(checked: Extraction): ExtractedDeadlineSummary[] {
  return checked.deadlines.map((d) => ({
    label: d.label,
    iso_utc: d.field.value.iso_utc,
    evidence_quote: d.field.evidence_quote,
    checked: d.field.checked,
  }));
}
