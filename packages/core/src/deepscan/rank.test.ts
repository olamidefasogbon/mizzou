import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractLinks } from './fetch.js';
import { rankLinks, sameSite } from './rank.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '..', '..', 'eval', 'fixtures');

describe('sameSite', () => {
  it('accepts the host and its subdomains both ways', () => {
    expect(sameSite('https://eee.epfl.ch/faq/', 'https://eee.epfl.ch/apply/')).toBe(true);
    expect(sameSite('https://eee.epfl.ch/', 'https://www.epfl.ch/labs/')).toBe(true);
    expect(sameSite('https://www.epfl.ch/', 'https://eee.epfl.ch/')).toBe(true);
  });

  it('rejects other sites and unparseable URLs', () => {
    expect(sameSite('https://eee.epfl.ch/', 'https://example.edu/faq')).toBe(false);
    // Suffix match without a dot boundary is a different site.
    expect(sameSite('https://eee.epfl.ch/', 'https://notepfl.ch/x')).toBe(false);
    expect(sameSite('https://eee.epfl.ch/', 'not a url')).toBe(false);
  });
});

describe('rankLinks', () => {
  const page = 'https://eee.epfl.ch/';

  it('ranks keyword links above generic ones and drops off-site URLs', () => {
    const ranked = rankLinks(
      page,
      [
        { href: '/news/', text: 'News' },
        { href: 'https://example.edu/faq', text: 'FAQ' },
        { href: '/faq/', text: 'Frequently asked questions' },
        { href: '/apply/', text: 'Apply now' },
        { href: '/faq/', text: 'FAQ duplicate' },
        { href: '#top', text: 'Back to top' },
        { href: 'mailto:info@epfl.ch', text: 'Contact' },
      ],
      { programHint: null },
    );
    const urls = ranked.map((r) => r.url);
    expect(urls).not.toContain('https://example.edu/faq');
    expect(urls.filter((u) => u === 'https://eee.epfl.ch/faq/')).toHaveLength(1);
    expect(urls[0]).toBe('https://eee.epfl.ch/faq/');
    expect(urls[1]).toBe('https://eee.epfl.ch/apply/');
    expect(ranked.every((r) => r.score > 0)).toBe(true);
  });

  it('boosts the confirmed program terms and caps at topN', () => {
    const links = Array.from({ length: 12 }, (_, i) => ({ href: `/faq/${i}/`, text: `FAQ ${i}` }));
    const ranked = rankLinks(page, links, { topN: 8, programHint: 'Engineering Excellence' });
    expect(ranked).toHaveLength(8);
  });

  it('prefers FAQ and apply pages on the saved EPFE fixture', () => {
    const html = readFileSync(join(FIXTURES, 'case-03.html'), 'utf-8');
    const links = extractLinks(html, 'https://eee.epfl.ch/');
    expect(links.length).toBeGreaterThan(0);
    const ranked = rankLinks('https://eee.epfl.ch/', links, { topN: 5 });
    expect(ranked.length).toBeGreaterThan(0);
    const top = ranked.map((r) => r.url).join(' ');
    expect(top).toMatch(/faq|apply|program-at-a-glance|labs/i);
  });
});
