import { describe, expect, it } from 'vitest';
import { ExtractionSchema } from '../schemas/extraction.js';
import { verifyExtractionEvidence } from './evidence.js';

function baseExtraction(overrides: Record<string, unknown> = {}) {
  return ExtractionSchema.parse({
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
});
