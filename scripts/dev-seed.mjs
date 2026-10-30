// Dev-only Coming up seed. Writes two clearly-labeled test reminders into
// the Supabase `reminders` table for one user id (RLS is bypassed with the
// service role key, so this runs on the host with server env, never in the
// browser and never in app code). Removes exactly those rows again.
// The no-demo-data guard scans apps/web/src and packages/core/src only.
//
// Usage:
//   pnpm dev:seed [--user <supabase-user-id>]     add "Test reminder A/B"
//   pnpm dev:unseed [--user <supabase-user-id>]   remove only the seeded rows
//
// Needs SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and
// SUPABASE_SERVICE_ROLE_KEY in the environment. Values are never printed.

const SEED_IDS = [
  '00000000-0000-4000-8000-00000000000a',
  '00000000-0000-4000-8000-00000000000b',
];
const DAY_MS = 24 * 60 * 60 * 1000;

function env(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name} in the environment.`);
    process.exit(1);
  }
  return value;
}

function shortDay(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function seedRows(userId) {
  const now = Date.now();
  return [
    { days: 3, label: 'A' },
    { days: 9, label: 'B' },
  ].map(({ days, label }, i) => {
    const dueAt = new Date(now + days * DAY_MS).toISOString();
    return {
      id: SEED_IDS[i],
      user_id: userId,
      title: `Test reminder ${label}`,
      status_line: `Due ${shortDay(dueAt)} (dev seed)`,
      pill: `in ${days}d`,
      due_at: dueAt,
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

async function main() {
  const { command, user } = parseArgs(process.argv);
  if ((command !== 'seed' && command !== 'unseed') || !user) {
    console.error('usage: node scripts/dev-seed.mjs [seed|unseed] --user <supabase-user-id>');
    process.exit(1);
  }
  const base = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
  if (!base) {
    console.error('Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) in the environment.');
    process.exit(1);
  }
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  if (command === 'seed') {
    const res = await fetch(`${base}/rest/v1/reminders?on_conflict=id`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(seedRows(user)),
    });
    if (!res.ok) {
      console.error(`seed failed: HTTP ${res.status}`);
      process.exit(1);
    }
    const rows = await res.json();
    console.log(`seed: ${rows.length} row(s) for user ${user} in reminders at ${base}`);
    for (const row of rows) console.log(`  ${row.id} ${row.title}`);
  } else {
    const params = new URLSearchParams({ id: `in.(${SEED_IDS.join(',')})`, user_id: `eq.${user}`, select: 'id' });
    const res = await fetch(`${base}/rest/v1/reminders?${params}`, {
      method: 'DELETE',
      headers: { ...headers, Prefer: 'return=representation' },
    });
    if (!res.ok) {
      console.error(`unseed failed: HTTP ${res.status}`);
      process.exit(1);
    }
    const rows = await res.json();
    console.log(`unseed: ${rows.length} row(s) removed for user ${user} in reminders at ${base}`);
  }
}

await main();
