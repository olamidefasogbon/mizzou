import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// M2 eval harness skeleton. Runs the same advance path as the app in
// autonomous mode with gates auto-approved. Baseline = single page, no link
// following; deep scan adds link ranking + parallel fetch (M4).
//
// Spend rules: default --limit 2 cases. A full 10-case run only on request.
// No model calls run without a labeled case and an explicit go-ahead.

interface EvalCase {
  id: string;
  kind: string;
  input: { type: string; value: string };
  expected: Record<string, unknown> | null;
  notes: string;
  labeled?: boolean;
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

function loadCases(dir: string): EvalCase[] {
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return [];
  }
  const cases: EvalCase[] = [];
  for (const f of files) {
    try {
      cases.push(JSON.parse(readFileSync(join(dir, f), 'utf-8')) as EvalCase);
    } catch (err) {
      console.error(`Skipping unreadable case ${f}: ${(err as Error).message}`);
    }
  }
  return cases;
}

const { limit, config } = parseArgs(process.argv.slice(2));
const casesDir = join(process.cwd(), 'cases');
const all = loadCases(casesDir);
const labeled = all.filter((c) => c.labeled === true && c.expected !== null);
const selected = labeled.slice(0, limit);

console.log(`mizzou eval (${config}): ${selected.length} of ${all.length} cases selected (limit ${limit}).`);
if (all.length === 0 || labeled.length === 0) {
  console.log('No labeled cases yet. Cases are hand-labeled by the human — see cases/README.md.');
  console.log('Baseline report: 0 of 0 deadlines correct; 0 requirements scored; spend $0.00.');
  process.exit(0);
}

// Deep-scan + model-backed scoring lands with the advance loop (M4).
// Until then, report only what was measured here.
console.log('Model-backed baseline scoring is not wired yet (needs advance loop + labeled cases).');
console.log(`Baseline report: 0 of ${selected.length} cases run; spend $0.00.`);
