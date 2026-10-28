import { describe, expect, it } from 'vitest';
import { ExtractionSchema } from '@mizzou/core';
import { deadlineHit, normDate, summarizeDeadlines } from './scoring.js';

// Locks the eval deadline rule for case-01 (expected: "Application Deadline",
// 2026-12-15T23:59:59Z) without calling any model.

const EXPECTED = { label: 'Application Deadline', iso_utc: '2026-12-15T23:59:59Z' };

describe('normDate', () => {
  it('keeps only the YYYY-MM-DD prefix', () => {
    expect(normDate('2026-12-15T23:59:59Z')).toBe('2026-12-15');
  });

  it('returns null when there is no date', () => {
    expect(normDate(null)).toBeNull();
    expect(normDate('')).toBeNull();
  });
});

describe('deadlineHit', () => {
  it('hits on the same UTC day when the label carries the expected first word', () => {
    const extracted = [{ label: 'Application deadline for Computer Science (PhD)', iso_utc: '2026-12-15T23:59:59Z' }];
    expect(deadlineHit(extracted, EXPECTED)).toBe(true);
  });

  it('misses a different UTC day', () => {
    const extracted = [{ label: 'Application Deadline', iso_utc: '2026-12-01T23:59:59Z' }];
    expect(deadlineHit(extracted, EXPECTED)).toBe(false);
  });

  it('misses when the label lacks the expected first word, even on the right day', () => {
    const extracted = [{ label: 'December 15, 2026', iso_utc: '2026-12-15T23:59:59Z' }];
    expect(deadlineHit(extracted, EXPECTED)).toBe(false);
  });

  it('documents the Eastern-midnight edge: a correct UTC conversion scores a miss today', () => {
    // The fixture states all application deadlines are "11:59 pm Eastern
    // time", so 23:59 EST on Dec 15 is 2026-12-16T04:59:59Z. The matcher
    // compares UTC calendar days, hence the miss. Locked in as current
    // behavior until scoring goes timezone-aware; do not "fix" by editing
    // this expectation — change the matcher instead.
    const extracted = [{ label: 'Application Deadline', iso_utc: '2026-12-16T04:59:59Z' }];
    expect(deadlineHit(extracted, EXPECTED)).toBe(false);
  });
});

describe('summarizeDeadlines', () => {
  it('persists the raw per-case deadlines for no-model audits', () => {
    const extraction = ExtractionSchema.parse({
      opportunity_type: 'academic_program',
      program: {
        name: { value: 'Yale Graduate School', evidence_quote: 'Yale Graduate School', source_url: 'https://example.edu/x', confidence: 'high', needs_human: false, checked: true },
        unit: { value: 'Graduate School', evidence_quote: 'Graduate School', source_url: 'https://example.edu/x', confidence: 'high', needs_human: false, checked: true },
        institution: { value: 'Yale University', evidence_quote: 'Yale University', source_url: 'https://example.edu/x', confidence: 'high', needs_human: false, checked: true },
        portal_url: null,
        language_read: 'en',
      },
      opens: null,
      deadlines: [
        {
          label: 'Application Deadline',
          field: {
            value: { iso_utc: '2026-12-15T23:59:59Z', original_tz: 'America/New_York', all_day: false, rolling: false },
            evidence_quote: 'December 15, 2026',
            source_url: 'https://example.edu/x',
            confidence: 'high',
            needs_human: false,
            checked: false,
          },
        },
      ],
      documents: [],
      eligibility: [],
      people: [],
      tests: [],
      money: [],
      unusual_rules: [],
    });
    expect(summarizeDeadlines(extraction)).toEqual([
      {
        label: 'Application Deadline',
        iso_utc: '2026-12-15T23:59:59Z',
        evidence_quote: 'December 15, 2026',
        checked: false,
      },
    ]);
  });
});
