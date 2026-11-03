import { describe, expect, it } from 'vitest';
import { buildCaseFile } from './casefile.js';
import type { ReconcilePage } from '../extract/reconcile.js';

function page(isoDeadlines: string[], docs = 0): ReconcilePage {
  return {
    url: 'https://example.edu/apply',
    title: 'Apply',
    extraction: {
      deadlines: isoDeadlines.map((iso) => ({ label: 'Application', field: { value: { iso_utc: iso } } })),
      documents: Array.from({ length: docs }, () => ({})),
      eligibility: [],
    },
  } as unknown as ReconcilePage;
}

const base = { g1Confirmed: true, programUrl: 'https://example.edu', pagesRead: 1, unreadable: 0, profileFacts: 1, now: new Date('2026-10-31T12:00:00Z') };

describe('case file', () => {
  it('says to read the apply, dates and FAQ pages itself when no deadline is found', () => {
    const text = buildCaseFile({ ...base, extractions: [page([], 0)] }).join('\n');
    expect(text).toMatch(/no deadline found yet/);
    expect(text).toMatch(/still want to apply/);
  });
  it('flags that every found deadline has passed', () => {
    const text = buildCaseFile({ ...base, extractions: [page(['2026-10-15T14:59:00Z'], 3)] }).join('\n');
    expect(text).toMatch(/already passed/);
    expect(text).toMatch(/1 passed/);
  });
  it('counts upcoming deadlines and says nothing essential is missing', () => {
    const text = buildCaseFile({ ...base, extractions: [page(['2027-04-15T14:59:00Z'], 3)] }).join('\n');
    expect(text).toMatch(/1 upcoming/);
    expect(text).toMatch(/Nothing essential is missing/);
  });
  it('asks the model to resolve G1 from a pasted URL when the program is unconfirmed', () => {
    const text = buildCaseFile({ ...base, g1Confirmed: false, pagesRead: 0, extractions: [] }).join('\n');
    expect(text).toMatch(/resolve_gate/);
  });
});
