import { DateTime } from 'luxon';
import { hasBannedTerm, hasLayoutReference, type Extraction } from '@mizzou/core';

// Pure scoring helpers for the eval runner (no model calls, no I/O).
//
// deadlineHit implements PROMPT.md section 10 ("date exact-match accuracy
// after timezone normalization"): the expected and extracted instants are
// compared by calendar day in the source page's wall timezone, so a naive
// wall-as-UTC value and a correct UTC conversion of the same deadline
// both hit. The expected label's first word must still appear in the
// extracted label.

// Wall timezone stated on the benchmark pages
// ("All application deadlines are as of 11:59 pm Eastern time").
export const SOURCE_TZ = 'America/New_York';

export const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

// Calendar day (YYYY-MM-DD) of an instant in the source wall timezone.
// Null for missing or unparseable input.
export const sourceDay = (s: string | null): string | null => {
  if (!s) return null;
  const dt = DateTime.fromISO(s, { zone: 'utc' });
  if (!dt.isValid) return null;
  return dt.setZone(SOURCE_TZ).toISODate();
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
  const wantDay = sourceDay(expected.iso_utc);
  const wantWord = norm(expected.label).split(' ')[0];
  return extracted.some((d) => sourceDay(d.iso_utc) === wantDay && norm(d.label).includes(wantWord));
}

export interface ExtractedDeadlineSummary {
  label: string;
  iso_utc: string | null;
  evidence_quote: string;
  checked: boolean;
}

// Conversational copy check (no model calls): every sample assistant reply
// must read like the voice section — no system words, no layout pointers.
// Returns one violation string per problem, empty when clean.
export function scoreCopyReply(text: string): string[] {
  const violations: string[] = [];
  if (hasBannedTerm(text)) violations.push('banned-term');
  if (hasLayoutReference(text)) violations.push('layout-reference');
  return violations;
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
