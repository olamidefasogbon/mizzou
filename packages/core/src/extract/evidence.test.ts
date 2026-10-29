import { describe, expect, it } from 'vitest';
import { ExtractionSchema } from '../schemas/extraction.js';
import { verifyExtractionEvidence } from './evidence.js';

function baseExtraction(overrides: Record<string, unknown> = {}) {
  return ExtractionSchema.parse({
    opportunity_type: 'academic_program',
    program: {
      name: { value: 'MSc Computer Science', evidence_quote: 'MSc Computer Science', source_url: 'https://example.edu/msc', confidence: 'high', needs_human: false, checked: false },
      unit: { value: 'School of Computing', evidence_quote: 'School of Computing', source_url: 'https://example.edu/msc', confidence: 'high', needs_human: false, checked: false },
      institution: { value: 'Example University', evidence_quote: 'Example University', source_url: 'https://example.edu/msc', confidence: 'high', needs_human: false, checked: false },
      portal_url: 'https://example.edu/apply',
      language_read: 'en',
    },
    opens: null,
    deadlines: [],
    documents: [],
    eligibility: [],
    people: [],
    tests: [],
    money: [],
    unusual_rules: [],
    ...overrides,
  });
}

const PAGE = `
Example University — School of Computing — MSc Computer Science.
Apply by 15 January 2027. You need two recommenders and a statement of
purpose of at most 1000 words. The application fee is $90, waived for
low-income applicants. A first-class honours degree is required.
Contact a supervisor before applying. GRE is optional.
Unusually: early-career applicants must add a work sample.
`;

describe('verifyExtractionEvidence', () => {
  it('marks matching quotes checked without lowering confidence', () => {
    const out = verifyExtractionEvidence(PAGE, baseExtraction());
    expect(out.program.name.checked).toBe(true);
    expect(out.program.name.confidence).toBe('high');
    expect(out.program.unit.checked).toBe(true);
    expect(out.program.institution.checked).toBe(true);
  });

  it('fails a quote that does not appear in the source text', () => {
    const ext = baseExtraction({
      documents: [
        { value: { name: 'Portfolio', limit: null, optional: false }, evidence_quote: 'Portfolio of paintings', source_url: 'https://example.edu/msc', confidence: 'high', needs_human: false, checked: false },
      ],
    });
    const out = verifyExtractionEvidence(PAGE, ext);
    expect(out.documents[0].checked).toBe(false);
    expect(out.documents[0].confidence).toBe('low');
  });

  it('checks every array section, not just documents', () => {
    const mk = (quote: string) => ({
      value: 'x', evidence_quote: quote, source_url: 'https://example.edu/msc', confidence: 'high' as const, needs_human: false, checked: false,
    });
    const ext = baseExtraction({
      eligibility: [{ value: { rule: 'First-class honours', hard: true }, evidence_quote: 'first-class honours degree is required', source_url: 'https://example.edu/msc', confidence: 'high', needs_human: false, checked: false }],
      people: [mk('two recommenders')],
      tests: [mk('GRE is optional')],
      money: [mk('application fee is $90')],
      unusual_rules: [mk('must add a work sample')],
    });
    const out = verifyExtractionEvidence(PAGE, ext);
    expect(out.eligibility[0].checked).toBe(true);
    expect(out.people[0].checked).toBe(true);
    expect(out.tests[0].checked).toBe(true);
    expect(out.money[0].checked).toBe(true);
    expect(out.unusual_rules[0].checked).toBe(true);
  });

  it('flags a date whose quote mentions a different year', () => {
    const ext = baseExtraction({
      deadlines: [
        {
          label: 'Final deadline',
          field: {
            value: { iso_utc: '2027-01-15T00:00:00Z', original_tz: null, all_day: true, rolling: false },
            evidence_quote: 'Apply by 15 January 2027',
            source_url: 'https://example.edu/msc',
            confidence: 'high',
            needs_human: false,
            checked: false,
          },
        },
        {
          label: 'Bogus deadline',
          field: {
            value: { iso_utc: '2028-05-01T00:00:00Z', original_tz: null, all_day: true, rolling: false },
            evidence_quote: 'Apply by 15 January 2027',
            source_url: 'https://example.edu/msc',
            confidence: 'high',
            needs_human: false,
            checked: false,
          },
        },
      ],
    });
    const out = verifyExtractionEvidence(PAGE, ext);
    expect(out.deadlines[0].field.checked).toBe(true);
    expect(out.deadlines[1].field.checked).toBe(false);
    expect(out.deadlines[1].field.confidence).toBe('low');
  });

  it('leaves the input object untouched', () => {
    const ext = baseExtraction();
    verifyExtractionEvidence(PAGE, ext);
    expect(ext.program.name.checked).toBe(false);
  });

  // Yale case-01 shape: the date lives in a heading ("January 2, 2027")
  // that governs an item line naming no year ("Deadline for fee waiver
  // requests"). The quote is verbatim and the year heads the section,
  // so the correct value must NOT score checked: false.
  const HEADING_PAGE = `Important dates. January 2, 2027 Deadline for fee waiver requests. Computer Science (MS). Apply by December 15, 2026.`;

  const yearLess = (iso: string, quote: string) => baseExtraction({
    deadlines: [
      {
        label: 'Deadline for fee waiver requests',
        field: {
          value: { iso_utc: iso, original_tz: null, all_day: true, rolling: false },
          evidence_quote: quote,
          source_url: 'https://gsas.yale.edu/dates-deadlines',
          confidence: 'high',
          needs_human: false,
          checked: false,
        },
      },
    ],
  });

  it('passes a year-less quote whose month and day match, year heading above', () => {
    const out = verifyExtractionEvidence(HEADING_PAGE, yearLess('2027-01-02T00:00:00Z', 'Deadline for fee waiver requests'));
    expect(out.deadlines[0].field.checked).toBe(true);
    expect(out.deadlines[0].field.confidence).toBe('high');
  });

  it('fails the same quote when the year does not match', () => {
    const out = verifyExtractionEvidence(HEADING_PAGE, yearLess('2028-01-02T00:00:00Z', 'Deadline for fee waiver requests'));
    expect(out.deadlines[0].field.checked).toBe(false);
    expect(out.deadlines[0].field.confidence).toBe('low');
  });

  it('fails a quote from a different section than the value', () => {
    const twoSections = `${HEADING_PAGE} February 5, 2027 Deadline for late transcripts.`;
    const ext = yearLess('2027-01-02T00:00:00Z', 'Deadline for late transcripts');
    const out = verifyExtractionEvidence(twoSections, ext);
    expect(out.deadlines[0].field.checked).toBe(false);
    const right = verifyExtractionEvidence(twoSections, yearLess('2027-02-05T00:00:00Z', 'Deadline for late transcripts'));
    expect(right.deadlines[0].field.checked).toBe(true);
  });
});
