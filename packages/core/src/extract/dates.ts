import type { Extraction } from '../schemas/extraction.js';

// Gate G2 date reconciliation for ambiguous or missing timezones.
// Code detects the date fields a reader left unclear (no ISO instant, no
// usable timezone, or a flagged conflict); the human resolves them at G2
// with both sources in front of them. Plain text throughout, no emoji.

export type DateIssueReason = 'missing-iso' | 'missing-timezone' | 'conflict';

export interface DateIssue {
  /** 'opens' or `deadlines:${label}` — matches reconcile conflict fields. */
  field: string;
  /** Human-readable label: 'opening date' or the deadline label. */
  label: string;
  iso: string | null;
  original_tz: string | null;
  quote: string;
  source_url: string;
  reason: DateIssueReason;
}

function pushIssue(issues: DateIssue[], issue: DateIssue): void {
  if (!issues.some((i) => i.field === issue.field)) issues.push(issue);
}

/**
 * Collect every date field that needs a human at G2: deadlines or an
 * opening date with no ISO instant, an instant with no usable timezone
 * (all-day dates need none), or a field the reconcile step flagged.
 */
export function collectDateIssues(extraction: Extraction): DateIssue[] {
  const issues: DateIssue[] = [];
  if (extraction.opens) {
    const o = extraction.opens;
    const base = {
      field: 'opens',
      label: 'opening date',
      iso: o.value.iso_utc,
      original_tz: o.value.original_tz,
      quote: o.evidence_quote,
      source_url: o.source_url,
    };
    if (o.needs_human) {
      pushIssue(issues, { ...base, reason: 'conflict' });
    } else if (o.value.iso_utc === null) {
      pushIssue(issues, { ...base, reason: 'missing-iso' });
    } else if (o.value.original_tz === null && !o.value.all_day) {
      pushIssue(issues, { ...base, reason: 'missing-timezone' });
    }
  }
  for (const d of extraction.deadlines) {
    const base = {
      field: `deadlines:${d.label}`,
      label: d.label,
      iso: d.field.value.iso_utc,
      original_tz: d.field.value.original_tz,
      quote: d.field.evidence_quote,
      source_url: d.field.source_url,
    };
    if (d.field.needs_human) {
      pushIssue(issues, { ...base, reason: 'conflict' });
    } else if (d.field.value.iso_utc === null) {
      pushIssue(issues, { ...base, reason: 'missing-iso' });
    } else if (d.field.value.original_tz === null && !d.field.value.all_day) {
      pushIssue(issues, { ...base, reason: 'missing-timezone' });
    }
  }
  return issues;
}

/** One plain-text G2 question covering the unclear dates. No emoji. */
export function formatG2DateQuestion(issues: DateIssue[]): string {
  if (issues.length === 0) return '';
  if (issues.length === 1) {
    const only = issues[0];
    return `The page is unclear about ${only.label} (${only.quote}). Which date should I use?`;
  }
  const names = issues.slice(0, 3).map((i) => i.label).join('; ');
  return `The page leaves ${issues.length} dates unclear (${names}). Which dates should I use?`;
}
