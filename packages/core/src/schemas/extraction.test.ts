import { describe, expect, it } from 'vitest';
import { ExtractionSchema, OpportunityTypeSchema } from './extraction.js';

const TYPES = [
  'academic_program',
  'job',
  'fellowship',
  'grant',
  'competition',
  'hackathon',
  'scholarship',
  'incubator',
  'generic_opportunity',
] as const;

function minimal(opportunity_type: string) {
  return {
    opportunity_type,
    program: {
      name: { value: 'X', evidence_quote: 'X', source_url: 'https://example.edu', confidence: 'high' as const },
      unit: { value: 'U', evidence_quote: 'U', source_url: 'https://example.edu', confidence: 'high' as const },
      institution: { value: 'I', evidence_quote: 'I', source_url: 'https://example.edu', confidence: 'high' as const },
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
  };
}

describe('OpportunityTypeSchema', () => {
  it('accepts every taxonomy value', () => {
    for (const t of TYPES) {
      expect(OpportunityTypeSchema.parse(t)).toBe(t);
    }
  });

  it('rejects unknown types', () => {
    expect(() => OpportunityTypeSchema.parse('degree')).toThrow();
  });
});

describe('ExtractionSchema opportunity_type', () => {
  it('requires the field and keeps it through parsing', () => {
    const parsed = ExtractionSchema.parse(minimal('job'));
    expect(parsed.opportunity_type).toBe('job');
  });

  it('rejects payloads without a type', () => {
    const { opportunity_type: _dropped, ...rest } = minimal('job');
    expect(() => ExtractionSchema.parse(rest)).toThrow();
  });
});
