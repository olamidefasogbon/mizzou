import { describe, expect, it } from 'vitest';
import type { Extraction } from '../schemas/extraction.js';
import {
  reconcileExtractions,
  resolveConflictsWithJudge,
  type ReconcilePage,
} from './reconcile.js';

function evStr(value: string, url: string, quote?: string) {
  return { value, evidence_quote: quote ?? value, source_url: url, confidence: 'high' as const, needs_human: false, checked: true };
}

function deadline(label: string, iso: string, url: string, quote?: string) {
  return {
    label,
    field: {
      value: { iso_utc: iso, original_tz: null, all_day: true, rolling: false },
      evidence_quote: quote ?? label,
      source_url: url,
      confidence: 'high' as const,
      needs_human: false,
      checked: true,
    },
  };
}

function makeExtraction(url: string, deadlines: Array<ReturnType<typeof deadline>> = []): Extraction {
  return {
    opportunity_type: 'academic_program',
    program: {
      name: evStr('Program', url),
      unit: evStr('Unit', url),
      institution: evStr('Inst', url),
      portal_url: null,
      language_read: 'en',
    },
    opens: null,
    deadlines,
    documents: [],
    eligibility: [],
    people: [],
    tests: [],
    money: [],
    unusual_rules: [],
  };
}

const SITE = 'https://scan.example';

describe('reconcileExtractions', () => {
  it('merges clean pages with no conflicts', () => {
    const pages: ReconcilePage[] = [
      { url: `${SITE}/`, title: 'Program', extraction: makeExtraction(`${SITE}/`, [deadline('Main deadline', '2026-12-01T00:00:00Z', `${SITE}/`)]) },
      { url: `${SITE}/faq/`, title: 'FAQ', extraction: makeExtraction(`${SITE}/faq/`, [deadline('Fee waiver', '2027-01-02T00:00:00Z', `${SITE}/faq/`)]) },
    ];
    const { merged, conflicts } = reconcileExtractions(pages, `${SITE}/`);
    expect(conflicts).toEqual([]);
    expect(merged?.deadlines.map((d) => d.label)).toEqual(['Main deadline', 'Fee waiver']);
    expect(merged?.deadlines.every((d) => d.field.needs_human === false)).toBe(true);
  });

  it('dedupes the same deadline read twice', () => {
    const dl = deadline('Main deadline', '2026-12-01T00:00:00Z', `${SITE}/`);
    const pages: ReconcilePage[] = [
      { url: `${SITE}/`, title: 'P', extraction: makeExtraction(`${SITE}/`, [dl]) },
      { url: `${SITE}/faq/`, title: 'F', extraction: makeExtraction(`${SITE}/faq/`, [deadline('Main deadline', '2026-12-01T00:00:00Z', `${SITE}/faq/`)]) },
    ];
    const { merged, conflicts } = reconcileExtractions(pages, `${SITE}/`);
    expect(conflicts).toEqual([]);
    expect(merged?.deadlines).toHaveLength(1);
  });

  it('flags the same label with different dates as a G2 conflict', () => {
    const pages: ReconcilePage[] = [
      { url: `${SITE}/`, title: 'P', extraction: makeExtraction(`${SITE}/`, [deadline('Main deadline', '2026-12-01T00:00:00Z', `${SITE}/`)]) },
      { url: `${SITE}/dept/`, title: 'D', extraction: makeExtraction(`${SITE}/dept/`, [deadline('Main deadline', '2026-12-15T00:00:00Z', `${SITE}/dept/`)]) },
    ];
    const { merged, conflicts } = reconcileExtractions(pages, `${SITE}/`);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].field).toBe('deadlines:Main deadline');
    expect(conflicts[0].values.map((v) => v.source_url)).toEqual([`${SITE}/`, `${SITE}/dept/`]);
    expect(merged?.deadlines.every((d) => d.field.needs_human)).toBe(true);
  });

  it('flags a different opening date as a conflict, program page winning silently when equal', () => {
    const open = (iso: string, url: string) => ({
      value: { iso_utc: iso, original_tz: null, all_day: true, rolling: false },
      evidence_quote: 'Opens',
      source_url: url,
      confidence: 'high' as const,
      needs_human: false,
      checked: true,
    });
    const a = makeExtraction(`${SITE}/`);
    a.opens = open('2026-11-01T00:00:00Z', `${SITE}/`);
    const b = makeExtraction(`${SITE}/dept/`);
    b.opens = open('2026-11-15T00:00:00Z', `${SITE}/dept/`);
    const { merged, conflicts } = reconcileExtractions(
      [{ url: `${SITE}/`, title: 'P', extraction: a }, { url: `${SITE}/dept/`, title: 'D', extraction: b }],
      `${SITE}/`,
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].field).toBe('opens');
    expect(merged?.opens?.needs_human).toBe(true);
  });

  it('returns null merged with no pages', () => {
    expect(reconcileExtractions([], `${SITE}/`)).toEqual({ merged: null, conflicts: [] });
  });
});

describe('resolveConflictsWithJudge', () => {
  function conflicted() {
    const pages: ReconcilePage[] = [
      { url: `${SITE}/`, title: 'P', extraction: makeExtraction(`${SITE}/`, [deadline('Main deadline', '2026-12-01T00:00:00Z', `${SITE}/`)]) },
      { url: `${SITE}/dept/`, title: 'D', extraction: makeExtraction(`${SITE}/dept/`, [deadline('Main deadline', '2026-12-15T00:00:00Z', `${SITE}/dept/`)]) },
    ];
    return reconcileExtractions(pages, `${SITE}/`);
  }

  it('applies the winning value and clears the flag', async () => {
    const { merged, conflicts } = conflicted();
    const out = await resolveConflictsWithJudge(
      merged!,
      conflicts,
      async () => ({ verdict: { resolutions: [{ field: 'deadlines:Main deadline', chosen_iso: '2026-12-01T00:00:00Z', reason: 'Program page governs.' }] }, costUsd: 0.02 }),
    );
    expect(out.remaining).toEqual([]);
    expect(out.merged.deadlines).toHaveLength(1);
    expect(out.merged.deadlines[0].field.value.iso_utc).toBe('2026-12-01T00:00:00Z');
    expect(out.merged.deadlines[0].field.needs_human).toBe(false);
    expect(out.costUsd).toBe(0.02);
  });

  it('keeps an unresolved conflict for G2', async () => {
    const { merged, conflicts } = conflicted();
    const out = await resolveConflictsWithJudge(
      merged!,
      conflicts,
      async () => ({ verdict: { resolutions: [{ field: 'deadlines:Main deadline', chosen_iso: null, reason: 'Neither source clearly wins.' }] }, costUsd: 0.02 }),
    );
    expect(out.remaining).toHaveLength(1);
    expect(out.merged.deadlines.every((d) => d.field.needs_human)).toBe(true);
  });

  it('treats a judge outage as unresolved, not fatal', async () => {
    const { merged, conflicts } = conflicted();
    const out = await resolveConflictsWithJudge(merged!, conflicts, async () => {
      throw new Error('down');
    });
    expect(out.remaining).toHaveLength(1);
    expect(out.costUsd).toBe(0);
  });

  it('skips the judge entirely when nothing conflicts', async () => {
    let calls = 0;
    const { merged, conflicts } = reconcileExtractions(
      [{ url: `${SITE}/`, title: 'P', extraction: makeExtraction(`${SITE}/`) }],
      `${SITE}/`,
    );
    const out = await resolveConflictsWithJudge(merged!, conflicts, async () => {
      calls += 1;
      return { verdict: { resolutions: [] }, costUsd: 0 };
    });
    expect(calls).toBe(0);
    expect(out.remaining).toEqual([]);
    expect(out.costUsd).toBe(0);
  });
});
