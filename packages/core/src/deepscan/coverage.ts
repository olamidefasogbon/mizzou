import { SAY_PAGE_WOULD_NOT_OPEN, formatCoverageRead, sayLanguageRead } from '../voice/index.js';

// Coverage card payload (PROMPT.md 6.3 step 6): plain friendly words about
// what was read, which page would not open (with its link), and whether
// anything was read in another language. Emitted as a `coverage` card event
// when the scan finishes — and at a G2 halt, so the question carries context.

export interface CoverageInput {
  pagesRead: Array<{ url: string; title: string }>;
  unreadable: Array<{ url: string; reason: string }>;
  languages: string[];
}

export interface CoveragePayload {
  lines: string[];
  /** Pages that were read, for the sources list in the UI. */
  pages: Array<{ url: string; title: string }>;
  /** Non-English languages that were read, for the sources list. */
  languages: string[];
  unreadable: Array<{ url: string; reason: string }>;
}

export function buildCoveragePayload(input: CoverageInput): CoveragePayload {
  const lines: string[] = [];
  lines.push(formatCoverageRead(input.pagesRead.map((p) => p.title || p.url)));
  for (const u of input.unreadable) {
    lines.push(`${SAY_PAGE_WOULD_NOT_OPEN} (${u.url})`);
  }
  for (const lang of input.languages) {
    if (lang.toLowerCase() !== 'en' && lang.trim() !== '') {
      lines.push(sayLanguageRead(lang));
    }
  }
  const otherLanguages = input.languages.filter((l) => l.trim() !== '' && l.toLowerCase() !== 'en');
  return { lines, languages: otherLanguages, pages: input.pagesRead.map((p) => ({ url: p.url, title: p.title || p.url })), unreadable: input.unreadable };
}
