// Link ranking in code, never the model (PROMPT.md section 6.5 step 2 and
// tool table: find_links). Same official site only; keywords from the spec
// plus the confirmed program's own terms.

export interface RankInput {
  href: string;
  text: string;
}

export interface RankedLink {
  url: string;
  text: string;
  score: number;
}

const KEYWORDS = [
  'faq',
  'apply',
  'application',
  'admissions',
  'requirements',
  'international',
  'funding',
  'fees',
  'fee',
  'deadline',
  'deadlines',
  'prospective',
  'eligibility',
  'eligible',
  'guidelines',
  'how-to-apply',
  'selection',
];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Same official site: identical registrable domain. Heuristic without a
 * public-suffix list — last two labels, or three for two-letter second
 * levels (ac.uk, co.uk, edu.tw) — so sibling subdomains (eee. / www.)
 * stay in scope while lookalike domains stay out.
 */
function registrableDomain(host: string): string {
  const parts = host.toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const second = parts[parts.length - 2] ?? '';
  const top = parts[parts.length - 1] ?? '';
  if (top.length === 2 && second.length <= 3) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

export function sameSite(pageUrl: string, href: string): boolean {
  const pageHost = hostOf(pageUrl);
  const linkHost = hostOf(href);
  if (!pageHost || !linkHost) return false;
  return registrableDomain(pageHost) === registrableDomain(linkHost);
}

function hintTerms(programHint: string | null | undefined): string[] {
  if (!programHint) return [];
  return programHint
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);
}

function scoreLink(pathAndQuery: string, text: string, hint: string[]): number {
  const hay = `${pathAndQuery} ${text}`.toLowerCase();
  const urlPart = pathAndQuery.toLowerCase();
  let score = 0;
  for (const kw of KEYWORDS) {
    if (urlPart.includes(kw)) score += 2;
    else if (hay.includes(kw)) score += 1;
  }
  for (const term of hint) {
    if (urlPart.includes(term)) score += 2;
    else if (hay.includes(term)) score += 1;
  }
  return score;
}

/**
 * find_links: rank a page's outbound links with code. Drops off-site URLs,
 * anchors, and non-http(s) targets. Stable order for ties; returns the
 * top N with a positive score.
 */
export function rankLinks(
  pageUrl: string,
  links: RankInput[],
  opts: { topN?: number; programHint?: string | null } = {},
): RankedLink[] {
  const topN = opts.topN ?? 8;
  const hint = hintTerms(opts.programHint);
  const seen = new Set<string>();
  const ranked: Array<RankedLink & { order: number }> = [];
  links.forEach((link, order) => {
    let url: string;
    try {
      url = new URL(link.href, pageUrl).toString();
    } catch {
      return;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) return;
    if (url.split('#')[0] === pageUrl.split('#')[0]) return;
    if (!sameSite(pageUrl, url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    let pathAndQuery = url;
    try {
      const u = new URL(url);
      pathAndQuery = `${u.pathname}${u.search}`;
    } catch {
      // absolute URL already validated above; keep as-is
    }
    ranked.push({ url, text: link.text.trim().slice(0, 120), score: scoreLink(pathAndQuery, link.text, hint), order });
  });
  return ranked
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, topN)
    .map(({ url, text, score }) => ({ url, text, score }));
}
