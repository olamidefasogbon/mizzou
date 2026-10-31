import { describe, expect, it } from 'vitest';
import { readImageExtraction } from './vision.js';
import type { Extraction } from '../schemas/extraction.js';

function ev(value: string, quote: string, source = 'upload:upl-abc123') {
  return { value, evidence_quote: quote, source_url: source, confidence: 'high' as const, needs_human: false, checked: false };
}

function dateField(iso: string, quote: string) {
  return {
    value: { iso_utc: iso, original_tz: null, all_day: true, rolling: false },
    evidence_quote: quote,
    source_url: 'upload:upl-abc123',
    confidence: 'high' as const,
    needs_human: false,
    checked: false,
  };
}

// Vision role reads the SAME extraction schema from the image; evidence
// quotes come from the image text and dates must never be invented.
describe('readImageExtraction', () => {
  it('sends the image to the vision role and verifies the extraction', async () => {
    const extraction = {
      opportunity_type: 'academic_program',
      program: {
        name: ev('Computer Science MS', 'Computer Science MS'),
        unit: ev('Engineering', 'College of Engineering'),
        institution: ev('Example University', 'Example University'),
        portal_url: null,
        language_read: 'en',
      },
      opens: null,
      deadlines: [
        { label: 'Fall deadline', field: dateField('2027-01-15T00:00:00Z', 'Fall deadline: January 15, 2027') },
        // Invented: the quote names no year, so the check must fail it.
        { label: 'Fee waiver', field: dateField('2027-01-02T00:00:00Z', 'Deadline for fee waiver requests') },
      ],
      documents: [],
      eligibility: [],
      people: [],
      tests: [],
      money: [],
      unusual_rules: [],
    } as unknown as Extraction;
    let seen: { role?: unknown; images?: unknown } = {};
    const result = await readImageExtraction({
      name: 'flyer.png',
      sourceUrl: 'upload:upl-abc123',
      dataUrl: 'data:image/png;base64,AAA',
      call: (async (opts: { role: unknown; images?: unknown; schema?: unknown }) => {
        seen = opts;
        return { data: extraction, model: 'muse-spark-1.3', costUsd: 0.01, usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
      }) as never,
    });
    expect(seen.role).toBe('vision');
    expect(seen.images).toEqual(['data:image/png;base64,AAA']);
    expect(result.extraction.deadlines[0].field.checked).toBe(true);
    // The invented date is marked low and unchecked for the judge step.
    expect(result.extraction.deadlines[1].field.checked).toBe(false);
    expect(result.extraction.deadlines[1].field.confidence).toBe('low');
    expect(result.extraction.program.name.checked).toBe(true);
  });

  it('fails an empty quote without a page corpus', async () => {
    const extraction = {
      opportunity_type: 'scholarship',
      program: {
        name: ev('', ''),
        unit: ev('Awards', 'Awards office'),
        institution: ev('Example University', 'Example University'),
        portal_url: null,
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
    } as unknown as Extraction;
    const result = await readImageExtraction({
      name: 'shot.webp',
      sourceUrl: 'upload:upl-xyz',
      dataUrl: 'data:image/webp;base64,BBB',
      call: (async () => ({
        data: extraction,
        model: 'muse-spark-1.3',
        costUsd: 0.01,
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })) as never,
    });
    expect(result.extraction.program.name.checked).toBe(false);
    expect(result.extraction.program.unit.checked).toBe(true);
  });
});
