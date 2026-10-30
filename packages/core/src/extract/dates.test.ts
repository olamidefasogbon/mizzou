import { describe, expect, it } from 'vitest';
import type { Extraction } from '../schemas/extraction.js';
import { collectDateIssues, formatG2DateQuestion } from './dates.js';

const URL = 'https://example.edu/admissions';

function evStr(value: string) {
  return { value, evidence_quote: value, source_url: URL, confidence: 'high' as const, needs_human: false, checked: true };
}

function deadline(label: string, iso: string | null, tz: string | null, allDay: boolean, needsHuman = false) {
  return {
    label,
    field: {
      value: { iso_utc: iso, original_tz: tz, all_day: allDay, rolling: false },
      evidence_quote: `${label} line`,
      source_url: URL,
      confidence: 'high' as const,
      needs_human: needsHuman,
      checked: !needsHuman,
    },
  };
}

function makeExtraction(deadlines: Array<ReturnType<typeof deadline>> = [], opens: Extraction['opens'] = null): Extraction {
  return {
    opportunity_type: 'academic_program',
    program: {
      name: evStr('Program'),
      unit: evStr('Unit'),
      institution: evStr('Inst'),
      portal_url: null,
      language_read: 'en',
    },
    opens,
    deadlines,
    documents: [],
    eligibility: [],
    people: [],
    tests: [],
    money: [],
    unusual_rules: [],
  };
}

describe('collectDateIssues', () => {
  it('reports nothing for clear all-day dates', () => {
    const ex = makeExtraction([deadline('Main deadline', '2026-12-01T00:00:00Z', null, true)]);
    expect(collectDateIssues(ex)).toEqual([]);
  });

  it('flags a deadline with no ISO instant as missing-iso', () => {
    const ex = makeExtraction([deadline('Main deadline', null, null, true)]);
    expect(collectDateIssues(ex)).toEqual([
      expect.objectContaining({ field: 'deadlines:Main deadline', reason: 'missing-iso' }),
    ]);
  });

  it('flags a timed instant with no timezone as missing-timezone', () => {
    const ex = makeExtraction([deadline('Interview', '2026-12-01T14:00:00Z', null, false)]);
    expect(collectDateIssues(ex)).toEqual([
      expect.objectContaining({ field: 'deadlines:Interview', reason: 'missing-timezone' }),
    ]);
  });

  it('reports a flagged field once as a conflict, not twice', () => {
    const ex = makeExtraction([deadline('Main deadline', null, null, true, true)]);
    const issues = collectDateIssues(ex);
    expect(issues).toHaveLength(1);
    expect(issues[0].reason).toBe('conflict');
  });

  it('flags an opening date with no ISO instant', () => {
    const ex = makeExtraction([], {
      value: { iso_utc: null, original_tz: null, all_day: true, rolling: false },
      evidence_quote: 'Opens line',
      source_url: URL,
      confidence: 'high' as const,
      needs_human: false,
      checked: false,
    });
    expect(collectDateIssues(ex)).toEqual([expect.objectContaining({ field: 'opens', reason: 'missing-iso' })]);
  });
});

describe('formatG2DateQuestion', () => {
  it('asks a plain-text question naming the unclear date', () => {
    const ex = makeExtraction([deadline('Main deadline', null, null, true)]);
    const text = formatG2DateQuestion(collectDateIssues(ex));
    expect(text).toContain('Main deadline');
    expect(text).toContain('Which date should I use?');
    expect([...text].some((c) => /\p{Extended_Pictographic}/u.test(c))).toBe(false);
  });

  it('summarizes several unclear dates with a count', () => {
    const ex = makeExtraction([
      deadline('Main deadline', null, null, true),
      deadline('Interview', '2026-12-01T14:00:00Z', null, false),
    ]);
    const text = formatG2DateQuestion(collectDateIssues(ex));
    expect(text).toContain('2 dates');
    expect([...text].some((c) => /\p{Extended_Pictographic}/u.test(c))).toBe(false);
  });

  it('returns empty text when nothing is unclear', () => {
    expect(formatG2DateQuestion([])).toBe('');
  });
});
