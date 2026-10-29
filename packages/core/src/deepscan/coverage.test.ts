import { describe, expect, it } from 'vitest';
import { buildCoveragePayload } from './coverage.js';

describe('buildCoveragePayload', () => {
  it('names the pages read', () => {
    const out = buildCoveragePayload({
      pagesRead: [{ url: 'https://a.edu/x', title: 'Program' }, { url: 'https://a.edu/faq', title: 'FAQ' }],
      unreadable: [],
      languages: ['en'],
    });
    expect(out.lines[0]).toBe('I read 2 pages: Program; FAQ.');
  });

  it('names the page that would not open, with its link', () => {
    const out = buildCoveragePayload({
      pagesRead: [{ url: 'https://a.edu/x', title: 'Program' }],
      unreadable: [{ url: 'https://a.edu/fees', reason: 'PDF without text' }],
      languages: ['en'],
    });
    expect(out.lines.some((l) => l.includes('https://a.edu/fees'))).toBe(true);
    expect(out.lines.some((l) => l.includes('wouldn'))).toBe(true);
    expect(out.unreadable).toHaveLength(1);
  });

  it('adds the language line only for non-English reads', () => {
    const en = buildCoveragePayload({ pagesRead: [], unreadable: [], languages: ['en'] });
    expect(en.lines.some((l) => l.includes('I read this page in'))).toBe(false);
    const de = buildCoveragePayload({ pagesRead: [], unreadable: [], languages: ['en', 'German'] });
    expect(de.lines).toContain('I read this page in German.');
  });

  it('says plainly when nothing could be read', () => {
    const out = buildCoveragePayload({ pagesRead: [], unreadable: [], languages: [] });
    expect(out.lines[0]).toBe('I could not open any page to read.');
  });
});
