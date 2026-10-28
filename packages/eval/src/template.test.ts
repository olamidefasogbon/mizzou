import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sourceDay } from './scoring.ts';

// Locks the case-01 label to its saved fixture (no model calls).
// Fails loudly if the label drifts from what the page actually says.

const CASE_URL = new URL('../cases/case-01.template.json', import.meta.url);
const FIXTURE_URL = new URL('../fixtures/case-01.html', import.meta.url);

const template = JSON.parse(readFileSync(CASE_URL, 'utf-8')) as {
  program_hint: string;
  expected: { deadlines: Array<{ label: string; iso_utc: string }> };
  labeled: boolean;
};
const fixtureHtml = readFileSync(FIXTURE_URL, 'utf-8');
const fixtureText = fixtureHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('case-01 label', () => {
  it('is labeled with exactly one expected deadline', () => {
    expect(template.labeled).toBe(true);
    expect(template.expected.deadlines).toHaveLength(1);
  });

  it('stores a true UTC instant whose Eastern wall day is the labeled date', () => {
    // Page: "11:59 pm Eastern" on Dec 15 → 2026-12-16T04:59:59Z.
    expect(sourceDay(template.expected.deadlines[0].iso_utc)).toBe('2026-12-15');
  });

  it('names a program group that actually appears on the fixture page', () => {
    expect(fixtureText).toContain(template.program_hint);
    expect(template.expected.deadlines[0].label).toContain(template.program_hint);
  });

  it('labels a deadline date that appears on the fixture page', () => {
    expect(fixtureText).toContain('December 15, 2026');
  });

  it('keeps the matcher contract: label starts with the required word', () => {
    expect(template.expected.deadlines[0].label.toLowerCase().split(' ')[0]).toBe('application');
  });
});
