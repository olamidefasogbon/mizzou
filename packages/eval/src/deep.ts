import { readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deadlineHit, type ExtractedDeadline } from './scoring.ts';

// M4 step 6: deep-scan eval on saved fixtures only (no network).
// Runs the production loop (advance + model-driven deep-scan step with real
// reader/orchestrator/judge transports) over the fixture-backed mini site of
// case-01 and case-03, then compares case-01 against the single-page
// baseline. case-03 is unlabeled: reported raw, never scored.
// Usage: node src/deep.ts [--case case-01|case-03] (default: both).

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');

function loadLocalEnv(): void {
  if (process.env.MODEL_API_KEY || process.env.META_API_KEY) return;
  try {
    const text = readFileSync(join(PKG, '..', '..', '.env.local'), 'utf-8');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
        v = v.slice(1, -1);
      }
      if (k && !(k in process.env)) process.env[k] = v;
    }
  } catch {
    // No local file — real environment applies.
  }
}

loadLocalEnv();

const core = await import('@mizzou/core');
const { advance, createDeepScanStep, FileRunStore, newRun } = core;

function stripHtml(html: string): string {
  let t = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

function pageTitle(html: string, url: string): string {
  const m = html.match(/<title[^>]*>([\s\S]{1,200}?)<\/title>/i);
  return m ? stripHtml(m[1]) : url;
}

function pageLinks(html: string, base: string): Array<{ href: string; text: string }> {
  const out: Array<{ href: string; text: string }> = [];
  const re = /<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]{1,200}?)<\/a\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const url = new URL(m[1], base).toString();
      if (!url.startsWith('http')) continue;
      const text = stripHtml(m[2]).slice(0, 120);
      if (text) out.push({ href: url, text });
    } catch {
      // Skip unresolvable hrefs.
    }
  }
  return out;
}

interface DeepCase {
  id: string;
  programUrl: string;
  programHint: string;
  opportunityType: string;
  /** Exact URL (fragment stripped) -> fixture file. */
  files: Record<string, string>;
}

const CASES: DeepCase[] = [
  {
    id: 'case-01',
    programUrl: 'https://gsas.yale.edu/admissions/phdmasters-application-process/dates-deadlines',
    programHint: 'Computer Science (PhD)',
    opportunityType: 'academic_program',
    files: {
      'https://gsas.yale.edu/admissions/phdmasters-application-process/dates-deadlines': 'case-01.html',
    },
  },
  {
    id: 'case-03',
    programUrl: 'https://eee.epfl.ch/',
    programHint: 'EPFL Excellence in Engineering (E3) Summer Program',
    opportunityType: 'academic_program',
    files: {
      'https://eee.epfl.ch/': 'case-03.html',
      'https://eee.epfl.ch/faq/': 'case-03-faq.html',
      'https://eee.epfl.ch/faq': 'case-03-faq.html',
    },
  },
];

function normUrl(url: string): string {
  const u = new URL(url);
  u.hash = '';
  return u.toString();
}

async function runDeep(c: DeepCase): Promise<void> {
  const fetchPage = async (url: string) => {
    const file = c.files[normUrl(url)] ?? c.files[normUrl(url).replace(/\/$/, '')];
    if (!file) throw new Error(`no fixture saved for ${url}`);
    const html = readFileSync(join(PKG, 'fixtures', file), 'utf-8');
    return { title: pageTitle(html, url), text: stripHtml(html).slice(0, 60000), links: pageLinks(html, url) };
  };
  const dir = join(PKG, '.tmp-deep-eval');
  mkdirSync(dir, { recursive: true });
  try {
    const store = new FileRunStore(dir);
    const run = newRun(`deep-${c.id}`, 'eval', null);
    run.state = { programUrl: c.programUrl, programHint: c.programHint, opportunityType: c.opportunityType };
    await store.save(run);
    const step = createDeepScanStep({ fetchPage });
    let status = await advance(run.id, store, step, { maxTurns: 12 });
    let guard = 0;
    while (status.needsResume && status.run.status === 'running' && guard < 6) {
      guard += 1;
      status = await advance(run.id, store, step, { maxTurns: 12 });
    }
    const final = await store.load(run.id);
    const result = (final?.state as { result?: Record<string, unknown> } | undefined)?.result as
      | {
          programUrl: string;
          pagesRead: Array<{ url: string; title: string }>;
          unreadable: Array<{ url: string; reason: string }>;
          deadlinesFound: number;
          extraction: Record<string, unknown> | null;
          conflicts: unknown[];
          summary: string | null;
          usage: Array<{ turn: number; kind: string; tool: string | null; role: string | null; model: string | null; inputTokens: number | null; outputTokens: number | null; costUsd: number }>;
          usageUsd: number;
          error: string | null;
        }
      | undefined;
    console.log(`\n=== ${c.id}: status=${final?.status} turns=${final?.turnCount} error=${result?.error ?? 'none'} ===`);
    console.log(`pagesRead: ${(result?.pagesRead ?? []).map((p) => p.url).join(' | ') || '(none)'}`);
    console.log(`unreadable: ${(result?.unreadable ?? []).map((u) => `${u.url} (${u.reason})`).join(' | ') || '(none)'}`);
    console.log(`conflicts: ${(result?.conflicts ?? []).length} summary=${result?.summary ?? '(none)'}`);
    console.log('--- per-turn usage (every model call) ---');
    for (const u of result?.usage ?? []) {
      const tok = u.kind === 'model' ? `in=${u.inputTokens} out=${u.outputTokens}` : '-';
      console.log(`  turn ${u.turn} ${u.kind}:${u.tool ?? u.role} model=${u.model ?? '-'} ${tok} cost=$${u.costUsd.toFixed(6)}`);
    }
    console.log(`total usageUsd=$${(result?.usageUsd ?? 0).toFixed(6)}`);
    const ledgerSum = (result?.usage ?? []).reduce((n, u) => n + u.costUsd, 0);
    console.log(`ledger cross-check=$${ledgerSum.toFixed(6)} (must match total)`);
    const ext = result?.extraction as unknown as {
      deadlines: Array<{ label: string; field: { value: { iso_utc: string | null }; evidence_quote: string; checked: boolean; needs_human: boolean } }>;
      documents: Array<{ value: { name: string }; evidence_quote: string; checked: boolean; needs_human: boolean }>;
      eligibility: Array<{ value: { rule: string; hard: boolean }; evidence_quote: string; checked: boolean; needs_human: boolean }>;
    } | null;
    if (c.id === 'case-01' && ext) {
      const expected = { label: 'Application Deadline — Computer Science (PhD)', iso_utc: '2026-12-16T04:59:59Z' };
      const inputs: ExtractedDeadline[] = ext.deadlines.map((d) => ({ label: d.label, iso_utc: d.field.value.iso_utc }));
      console.log(`baseline compare: deadlineHit=${deadlineHit(inputs, expected)} (baseline 1/1)`);
      console.log(`deadlines: ${ext.deadlines.map((d) => `${d.label} -> ${d.field.value.iso_utc} checked=${d.field.checked} human=${d.field.needs_human}`).join(' | ')}`);
      const fields = [
        ...ext.deadlines.map((d) => d.field),
      ];
      console.log(`evidence: ${fields.filter((f) => f.checked).length}/${fields.length} deadlines checked (baseline 14/15 all fields)`);
      console.log(`documents: ${ext.documents.map((d) => d.value.name).join(' | ') || '(none)'}`);
      console.log(`needs_human flags: ${[...ext.deadlines.map((d) => d.field), ...ext.eligibility].filter((f) => f.needs_human).length}`);
    }
    if (c.id === 'case-03' && ext) {
      console.log(`deadlines: ${ext.deadlines.map((d) => `${d.label} -> ${d.field.value.iso_utc} checked=${d.field.checked} human=${d.field.needs_human} quote=${JSON.stringify(d.field.evidence_quote.slice(0, 90))}`).join('\n  ') || '(none)'}`);
      console.log(`documents: ${ext.documents.map((d) => d.value.name).join(' | ') || '(none)'}`);
      console.log(`eligibility: ${ext.eligibility.map((e) => `${e.value.rule} (hard=${e.value.hard})`).join(' | ') || '(none)'}`);
    }
    if (final?.status === 'needs_approval') {
      console.log(`G2 halt: ${JSON.stringify(final.pendingGate)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const argv = process.argv.slice(2);
const caseFlag = argv.indexOf('--case');
const only = caseFlag >= 0 ? argv[caseFlag + 1] : argv.find((a) => !a.startsWith('--'));
const picked = only ? CASES.filter((c) => c.id === only) : CASES;
if (picked.length === 0) {
  console.error(`unknown case (have: ${CASES.map((c) => c.id).join(', ')})`);
  process.exit(1);
}
console.log(`mizzou deep eval: ${picked.map((c) => c.id).join(', ')} (fixtures only, no network)`);
for (const c of picked) {
  await runDeep(c);
}
