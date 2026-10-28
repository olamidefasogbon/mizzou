import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Extraction } from '@mizzou/core';
import { deadlineHit, norm, summarizeDeadlines, type ExtractedDeadlineSummary } from './scoring.ts';

// M2 baseline runner. Single page, no link following, gates auto-approved.
// Executes the production reader path: callModel (role reader, zod schema,
// one repair retry, usage logging, budget guard) + the code evidence
// post-check. Spend rules: default --limit 2.
//
// Env: MODEL_API_KEY (META_API_KEY fallback) from process.env, or loaded
// from the repo-root .env.local when absent. The file is read silently and
// only to fill gaps — values are never printed. Never commit .env.local.

const HERE = dirname(fileURLToPath(import.meta.url)); // packages/eval/src
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
    // No local file (e.g. CI) — real environment applies.
  }
}

loadLocalEnv();

// Dynamic import AFTER env is loaded: @mizzou/core reads the key at import.
const { callModel, ExtractionSchema, verifyExtractionEvidence } = await import('@mizzou/core');

function apiKeyPresent(): boolean {
  return Boolean(process.env.MODEL_API_KEY || process.env.META_API_KEY);
}

function stripHtml(html: string): string {
  let t = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

interface ExpectedCase {
  id: string;
  kind: string;
  input: { type: string; value: string };
  expected: {
    opens: null | { iso_utc: string | null };
    deadlines: Array<{ label: string; iso_utc: string }>;
    documents: string[];
    unusual_rules: string[];
  } | null;
  notes: string;
  labeled?: boolean;
  // Confirmed program group this benchmark scores (mirrors the G1 context
  // the production deep scan runs with). Narrows attention, never the answer:
  // every date must still come from the page with an exact evidence quote.
  program_hint?: string | null;
}

const READER_PROMPT = (pageText: string, sourceUrl: string, programHint?: string | null): string =>
  `Extract application facts from the page text below. Return ONLY one JSON object with EXACTLY this structure ` +
  `(all keys present; null or [] where nothing is found; never guess a date):\n` +
  (programHint
    ? `Confirmed program context (post-G1): extract ALL deadlines on the page, and make sure the deadline for "${programHint}" is included with an exact evidence quote.\n`
    : '') +
  `{"opportunity_type": one of [academic_program|job|fellowship|grant|competition|hackathon|scholarship|incubator|generic_opportunity] — classify what the page offers,\n` +
  ` "program": {"name": EV_STR, "unit": EV_STR, "institution": EV_STR, "portal_url": string|null, "language_read": string},\n` +
  ` "opens": DATEFIELD|null,\n` +
  ` "deadlines": [{"label": string, "field": DATEFIELD}],\n` +
  ` "documents": [{"value": {"name": string, "limit": string|null, "optional": boolean}, "evidence_quote": string, "source_url": string, "confidence": CONF, "needs_human": boolean, "checked": boolean}],\n` +
  ` "eligibility": [{"value": {"rule": string, "hard": boolean}, "evidence_quote": string, "source_url": string, "confidence": CONF, "needs_human": boolean, "checked": boolean}],\n` +
  ` "people": [EV_STR], "tests": [EV_STR], "money": [EV_STR], "unusual_rules": [EV_STR]}\n` +
  `where EV_STR = {"value": string, "evidence_quote": string (max 400 chars, copied verbatim from the page text, must support the value), "source_url": string (always "${sourceUrl}"), "confidence": CONF, "needs_human": boolean, "checked": boolean},\n` +
  `CONF = "high"|"medium"|"low", and DATEFIELD = {"value": {"iso_utc": string|null (UTC as YYYY-MM-DDTHH:MM:SSZ), "original_tz": string|null, "all_day": boolean, "rolling": boolean}, "evidence_quote": string, "source_url": string, "confidence": CONF, "needs_human": boolean, "checked": boolean}.\n` +
  `PAGE TEXT:\n${pageText}`;

interface CaseResult {
  id: string;
  model: string;
  deadlinesCorrect: number;
  deadlinesTotal: number;
  extractedDeadlines: ExtractedDeadlineSummary[];
  docsRecallHit: number;
  docsExpected: number;
  docsPrecisionHit: number;
  docsReturned: number;
  evidencePassed: number;
  evidenceTotal: number;
  needsHuman: number;
  costUsd: number;
  latencyMs: number;
  notes: string;
}

async function runCase(c: ExpectedCase): Promise<CaseResult> {
  const t0 = Date.now();
  const fixturePath = join(PKG, 'fixtures', `${c.id}.html`);
  let html: string;
  if (existsSync(fixturePath)) {
    html = readFileSync(fixturePath, 'utf-8');
  } else {
    const r = await fetch(c.input.value, { headers: { 'User-Agent': 'Mozilla/5.0 Mizzou-eval-baseline' } });
    if (!r.ok) throw new Error(`fetch ${c.input.value} -> HTTP ${r.status}`);
    html = await r.text();
    mkdirSync(join(PKG, 'fixtures'), { recursive: true });
    writeFileSync(fixturePath, html);
  }
  const pageText = stripHtml(html).slice(0, 60000);

  const result = await callModel({
    role: 'reader',
    systemPrompt: 'You read one official admissions page into the extraction schema. Return only JSON matching the schema.',
    prompt: READER_PROMPT(pageText, c.input.value, c.program_hint ?? null),
    schema: ExtractionSchema,
    temperature: 0,
    userId: 'eval',
  });
  const data = result.data as Extraction;
  const usage = result.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  const checked = verifyExtractionEvidence(pageText, data);
  const fields: Array<{ checked?: unknown; needs_human?: unknown }> = [
    checked.program.name,
    checked.program.unit,
    checked.program.institution,
  ];
  if (checked.opens) fields.push(checked.opens);
  for (const d of checked.deadlines) fields.push(d.field);
  for (const d of checked.documents) fields.push(d);
  for (const d of checked.eligibility) fields.push(d);
  for (const d of checked.people) fields.push(d);
  for (const d of checked.tests) fields.push(d);
  for (const d of checked.money) fields.push(d);
  for (const d of checked.unusual_rules) fields.push(d);
  const evidencePassed = fields.filter((f) => f.checked === true).length;
  const needsHuman = fields.filter((f) => (f as { needs_human?: unknown }).needs_human === true).length;

  const exp = c.expected!;
  const extractedInputs = checked.deadlines.map((d) => ({ label: d.label, iso_utc: d.field.value.iso_utc }));
  let deadlinesCorrect = 0;
  for (const e of exp.deadlines) {
    if (deadlineHit(extractedInputs, e)) deadlinesCorrect += 1;
  }
  let docsRecallHit = 0;
  for (const e of exp.documents) {
    if (checked.documents.some((d) => norm(d.value.name).includes(norm(e)) || norm(e).includes(norm(d.value.name)))) {
      docsRecallHit += 1;
    }
  }
  let docsPrecisionHit = 0;
  for (const d of checked.documents) {
    if (exp.documents.some((e) => norm(d.value.name).includes(norm(e)) || norm(e).includes(norm(d.value.name)))) {
      docsPrecisionHit += 1;
    }
  }

  return {
    id: c.id,
    model: result.model,
    deadlinesCorrect,
    deadlinesTotal: exp.deadlines.length,
    extractedDeadlines: summarizeDeadlines(checked),
    docsRecallHit,
    docsExpected: exp.documents.length,
    docsPrecisionHit,
    docsReturned: checked.documents.length,
    evidencePassed,
    evidenceTotal: fields.length,
    needsHuman,
    costUsd: result.costUsd,
    latencyMs: Date.now() - t0,
    notes: c.notes,
  };
}

function parseArgs(argv: string[]): { limit: number; config: string } {
  let limit = 2;
  let config = 'baseline';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--limit' && i + 1 < argv.length) {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) limit = Math.floor(n);
      i += 1;
    } else if (argv[i] === '--config' && i + 1 < argv.length) {
      config = argv[i + 1];
      i += 1;
    }
  }
  return { limit, config };
}

const { limit, config } = parseArgs(process.argv.slice(2));
const casesDir = join(PKG, 'cases');
let files: string[] = [];
try {
  files = readdirSync(casesDir).filter((f) => f.endsWith('.json')).sort();
} catch {
  files = [];
}
const all: ExpectedCase[] = [];
for (const f of files) {
  try {
    all.push(JSON.parse(readFileSync(join(casesDir, f), 'utf-8')) as ExpectedCase);
  } catch (e) {
    console.error(`Skipping unreadable case ${f}: ${(e as Error).message}`);
  }
}
const labeled = all.filter((c) => c.labeled === true && c.expected !== null);
const selected = labeled.slice(0, limit);

console.log(`mizzou eval (${config}): ${selected.length} of ${all.length} cases selected (limit ${limit}).`);
if (selected.length === 0) {
  console.log('No labeled cases yet. Cases are hand-labeled by the human — see cases/README.md.');
  console.log('Baseline report: 0 of 0 deadlines correct; 0 requirements scored; spend $0.00.');
} else {
  if (!apiKeyPresent()) {
    throw new Error('Missing MODEL_API_KEY (or META_API_KEY). Export it or add it to .env.local; never commit it.');
  }
  const results: CaseResult[] = [];
  for (const c of selected) {
    try {
      results.push(await runCase(c));
    } catch (e) {
      console.error(`Case ${c.id} failed: ${(e as Error).message}`);
    }
  }

  let dCorr = 0;
  let dTot = 0;
  let rHit = 0;
  let rTot = 0;
  let pHit = 0;
  let pRet = 0;
  let ePass = 0;
  let eTot = 0;
  let cost = 0;
  for (const r of results) {
    dCorr += r.deadlinesCorrect;
    dTot += r.deadlinesTotal;
    rHit += r.docsRecallHit;
    rTot += r.docsExpected;
    pHit += r.docsPrecisionHit;
    pRet += r.docsReturned;
    ePass += r.evidencePassed;
    eTot += r.evidenceTotal;
    cost += r.costUsd;
    console.log(
      `- ${r.id} [${r.model}]: deadlines ${r.deadlinesCorrect}/${r.deadlinesTotal}, ` +
        `docs recall ${r.docsRecallHit}/${r.docsExpected}, precision ${r.docsPrecisionHit}/${r.docsReturned}, ` +
        `evidence ${r.evidencePassed}/${r.evidenceTotal}, needs_human ${r.needsHuman}, ` +
        `cost $${r.costUsd.toFixed(4)}, ${r.latencyMs}ms`,
    );
  }
  const recall = rTot === 0 ? 0 : rHit / rTot;
  const precision = pRet === 0 ? 0 : pHit / pRet;
  console.log(
    `Baseline report: ${dCorr} of ${dTot} deadlines correct; ` +
      `requirement recall ${(recall * 100).toFixed(1)}%, precision ${(precision * 100).toFixed(1)}%; ` +
      `evidence validity ${eTot === 0 ? '0/0' : `${ePass}/${eTot}`}; spend $${cost.toFixed(4)}.`,
  );

  const report =
    `# Mizzou eval report (baseline, ${new Date().toISOString()})\n\n` +
    `Config: single page, no link following, gates auto-approved, reader via callModel + zod schema + evidence post-check.\n\n` +
    `| case | deadlines | docs recall | docs precision | evidence | needs_human | cost USD | latency ms |\n` +
    `|---|---|---|---|---|---|---|---|\n` +
    results
      .map(
        (r) =>
          `| ${r.id} | ${r.deadlinesCorrect}/${r.deadlinesTotal} | ${r.docsRecallHit}/${r.docsExpected} | ` +
          `${r.docsPrecisionHit}/${r.docsReturned} | ${r.evidencePassed}/${r.evidenceTotal} | ${r.needsHuman} | ` +
          `${r.costUsd.toFixed(4)} | ${r.latencyMs} |`,
      )
      .join('\n') +
    `\n\nTotals: ${dCorr}/${dTot} deadlines correct; recall ${(recall * 100).toFixed(1)}%; ` +
    `precision ${(precision * 100).toFixed(1)}%; evidence ${ePass}/${eTot}; spend $${cost.toFixed(4)}.\n`;
  writeFileSync(join(PKG, '..', '..', 'docs', 'EVAL_REPORT.md'), report);
  writeFileSync(
    join(PKG, '..', '..', 'docs', 'eval-results.json'),
    JSON.stringify({ config, results, totals: { dCorr, dTot, recall, precision, ePass, eTot, cost }, at: new Date().toISOString() }, null, 2),
  );
  console.log('Wrote docs/EVAL_REPORT.md and docs/eval-results.json.');
}
