// Dev-only fixture fetcher (runs on the host, which has network).
// Usage: pnpm fixture:fetch <url> <caseId>
// Saves raw HTML + extracted text under packages/eval/fixtures/ as
// <caseId>.html and <caseId>.txt, and prints the text length.
// A page that renders as an empty JavaScript shell is REPORTED, not saved.

import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'packages', 'eval', 'fixtures');
const MIN_TEXT_CHARS = 500;

export function usage() {
  console.error('usage: pnpm fixture:fetch <url> <caseId>');
  console.error('example: pnpm fixture:fetch https://example.edu/apply case-11');
}

export function stripToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

/** Null when the page has real text; otherwise the shell markers found. */
export function looksLikeJsShell(html, text) {
  if (text.length >= MIN_TEXT_CHARS) return null;
  const markers = [];
  if (/<div id="root">\s*<\/div>/.test(html)) markers.push('empty #root');
  if (/<div id="__next"><\/div>/.test(html)) markers.push('empty #__next');
  if (/<body[^>]*>\s*<\/body>/.test(html)) markers.push('empty <body>');
  if (/enable javascript|requires javascript|javascript is (required|disabled)/i.test(text)) {
    markers.push('no-JS notice');
  }
  if (markers.length === 0 && text.length < 200) markers.push('near-empty body');
  return markers.length > 0 ? markers : null;
}

export async function main(argv) {
  const [, , url, caseId] = argv;
  if (!url || !caseId) {
    usage();
    process.exit(2);
  }
  let target;
  try {
    target = new URL(url);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error('bad protocol');
  } catch {
    console.error(`fixture:fetch: not an http(s) URL: ${url}`);
    process.exit(2);
  }
  if (!/^[a-z0-9-]+$/.test(caseId)) {
    console.error(`fixture:fetch: caseId must be lowercase letters, digits and dashes, got: ${caseId}`);
    process.exit(2);
  }

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 Mizzou-fixture-fetch', Accept: 'text/html' },
    signal: AbortSignal.timeout(30_000),
  }).catch((err) => {
    console.error(`fixture:fetch: request failed for ${url}: ${err?.message ?? err}`);
    process.exit(1);
  });
  if (!res.ok) {
    console.error(`fixture:fetch: HTTP ${res.status} for ${url}, nothing saved`);
    process.exit(1);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('html') && !contentType.includes('text')) {
    console.error(`fixture:fetch: unsupported content-type ${contentType || '(none)'} for ${url}, nothing saved`);
    process.exit(1);
  }
  const html = await res.text();
  const text = stripToText(html);
  const shellMarkers = looksLikeJsShell(html, text);
  if (shellMarkers) {
    console.error(
      `fixture:fetch: ${url} looks like an empty JavaScript shell (${shellMarkers.join(', ')}; ${text.length} text chars), nothing saved`,
    );
    process.exit(1);
  }

  await mkdir(FIXTURES, { recursive: true });
  const htmlPath = join(FIXTURES, `${caseId}.html`);
  const txtPath = join(FIXTURES, `${caseId}.txt`);
  await writeFile(htmlPath, html, 'utf8');
  await writeFile(txtPath, `Source: ${url}\nFetched: ${new Date().toISOString()}\n\n${text}`, 'utf8');
  console.log(`fixture:fetch: saved ${htmlPath} (${html.length} bytes)`);
  console.log(`fixture:fetch: saved ${txtPath} (${text.length} text chars)`);
}

const invokedAsCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsCli) await main(process.argv);
