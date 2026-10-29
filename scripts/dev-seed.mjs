// Dev-only Coming up seed. Writes two clearly-labeled test reminders into
// the local file store (same files apps/web/src/lib/stores.ts uses) and
// removes exactly those rows again. Never imported by app code: the
// no-demo-data guard scans apps/web/src and packages/core/src only.
//
// Usage:
//   pnpm dev:seed [--user <anon-id>]     add "Test reminder A/B"
//   pnpm dev:unseed [--user <anon-id>]   remove only the seeded rows
//
// Without --user, every user id already present in the store files is
// seeded. With a fresh store, load /app once, copy the mizzou-anon-id
// cookie (devtools > Application > Cookies) and pass it as --user.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SEED_IDS = ['dev-seed-a', 'dev-seed-b'];
const DAY_MS = 24 * 60 * 60 * 1000;

function dataDir() {
  return process.env.MIZZOU_DATA_DIR ?? join(tmpdir(), 'mizzou');
}

function remindersFile() {
  return join(dataDir(), 'reminders.json');
}

async function readRows(file) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeRows(file, rows) {
  await mkdir(dataDir(), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(rows), 'utf-8');
  await rename(tmp, file);
}

function shortDay(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function seedRows(userId) {
  const now = Date.now();
  const defs = [
    { id: SEED_IDS[0], days: 3 },
    { id: SEED_IDS[1], days: 9 },
  ];
  return defs.map(({ id, days }) => {
    const dueAt = new Date(now + days * DAY_MS).toISOString();
    const label = id === SEED_IDS[0] ? 'A' : 'B';
    return {
      id,
      userId,
      title: `Test reminder ${label}`,
      sub: `Due ${shortDay(dueAt)} (dev seed)`,
      pill: `in ${days}d`,
      dueAt,
      kind: 'custom',
      done: false,
    };
  });
}

function parseArgs(argv) {
  const args = { command: argv[2], user: null };
  const at = argv.indexOf('--user');
  if (at !== -1) args.user = argv[at + 1] ?? null;
  return args;
}

async function discoverUsers() {
  const files = [remindersFile(), join(dataDir(), 'chats.json')];
  const ids = new Set();
  for (const file of files) {
    for (const row of await readRows(file)) {
      if (row && typeof row.userId === 'string') ids.add(row.userId);
    }
  }
  return [...ids];
}

async function main() {
  const { command, user } = parseArgs(process.argv);
  if (command !== 'seed' && command !== 'unseed') {
    console.error('usage: node scripts/dev-seed.mjs [seed|unseed] [--user <anon-id>]');
    process.exit(1);
  }
  const file = remindersFile();
  const targets = user ? [user] : await discoverUsers();
  if (targets.length === 0) {
    console.error(
      'No user ids in the local store yet. Load /app once in the browser, copy the mizzou-anon-id cookie, and re-run with --user <anon-id>.',
    );
    process.exit(1);
  }
  const rows = await readRows(file);
  if (command === 'seed') {
    let added = 0;
    for (const userId of targets) {
      for (const row of seedRows(userId)) {
        if (rows.some((r) => r.id === row.id)) continue;
        rows.push(row);
        added += 1;
      }
    }
    await writeRows(file, rows);
    console.log(`seed: ${added} row(s) added, ${targets.length} user(s). Wrote ${file}`);
  } else {
    const before = rows.length;
    const kept = rows.filter((r) => !SEED_IDS.includes(r.id));
    await writeRows(file, kept);
    console.log(`unseed: ${before - kept.length} row(s) removed. Wrote ${file}`);
  }
}

await main();
