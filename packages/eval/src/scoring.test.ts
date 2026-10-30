import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ExtractionSchema } from '@mizzou/core';
import { deadlineHit, scoreCopyReply, sourceDay, summarizeDeadlines } from './scoring.ts';

// Locks the eval deadline rule for case-01 without calling any model.
// Label: "Application Deadline — Computer Science (PhD)",
// true UTC instant of 23:59 EST Dec 15: 2026-12-16T04:59:59Z.

const EXPECTED = { label: 'Application Deadline — Computer Science (PhD)', iso_utc: '2026-12-16T04:59:59Z' };

describe('sourceDay', () => {
  it('reads the calendar day in the source wall timezone', () => {
    expect(sourceDay('2026-12-15T23:59:59Z')).toBe('2026-12-15');
  });

  it('normalizes a correct UTC conversion back to the same wall day', () => {
    // 23:59 EST Dec 15 == 04:59 UTC Dec 16.
    expect(sourceDay('2026-12-16T04:59:59Z')).toBe('2026-12-15');
  });

  it('returns null when there is no usable date', () => {
    expect(sourceDay(null)).toBeNull();
    expect(sourceDay('')).toBeNull();
    expect(sourceDay('not-a-date')).toBeNull();
  });
});

describe('deadlineHit', () => {
  it('hits for a naive wall-as-UTC value on the right Eastern day', () => {
    const extracted = [{ label: 'Application deadline for Computer Science (PhD)', iso_utc: '2026-12-15T23:59:59Z' }];
    expect(deadlineHit(extracted, EXPECTED)).toBe(true);
  });

  it('hits for a correct UTC conversion of the same deadline', () => {
    // This scored a miss under the old UTC-calendar-day rule (the case-01 0/1).
    const extracted = [{ label: 'Application Deadline', iso_utc: '2026-12-16T04:59:59Z' }];
    expect(deadlineHit(extracted, EXPECTED)).toBe(true);
  });

  it('misses a different Eastern day', () => {
    const extracted = [{ label: 'Application Deadline', iso_utc: '2026-12-01T23:59:59Z' }];
    expect(deadlineHit(extracted, EXPECTED)).toBe(false);
  });

  it('misses when the label lacks the expected first word, even on the right day', () => {
    const extracted = [{ label: 'December 15, 2026', iso_utc: '2026-12-15T23:59:59Z' }];
    expect(deadlineHit(extracted, EXPECTED)).toBe(false);
  });
});

describe('scoreCopyReply', () => {
  it('passes sharp friend-texting replies', () => {
    expect(scoreCopyReply('Found it — Northeastern\u2019s Align MSCS. Is this the one?')).toEqual([]);
    expect(scoreCopyReply('Two dates on this one: December 15 and January 5. Which should I plan around?')).toEqual([]);
  });

  it('flags system words and layout pointers', () => {
    expect(scoreCopyReply('As an AI assistant, see the card above.')).toEqual(['banned-term', 'layout-reference']);
    expect(scoreCopyReply('The details are listed below.')).toEqual(['layout-reference']);
  });

  it('scores every conversational sample reply clean', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const fixture = JSON.parse(readFileSync(join(here, '..', 'cases', 'conversational-samples.json'), 'utf8')) as {
      replies: string[];
    };
    expect(fixture.replies.length).toBeGreaterThan(0);
    for (const reply of fixture.replies) {
      expect(scoreCopyReply(reply)).toEqual([]);
    }
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
            value: { iso_utc: '2026-12-16T04:59:59Z', original_tz: 'America/New_York', all_day: false, rolling: false },
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
        iso_utc: '2026-12-16T04:59:59Z',
        evidence_quote: 'December 15, 2026',
        checked: false,
      },
    ]);
  });
});
