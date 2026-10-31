import { NextResponse } from 'next/server';
import { AuthRequiredError, resolveUser } from '@/lib/auth';
import { repo } from '@/lib/repo';
import { supabaseServer } from '@/lib/supabase/server.ts';
import { runCalendarSync, type SyncFetch, type SyncLedgerRow } from '@/lib/calendar-sync.ts';

// POST /api/calendar/sync — write plan deadlines to the user's Google
// Calendar (PROMPT.md 7.3, M7). Body: { title, deadlines?, portalUrl? }.
// The Google access token comes from the user's own Supabase session: no
// token means the Calendar scope was never granted (incremental consent),
// so the client links Google with the Calendar scope and retries. A
// declined grant or a blocked (unverified-app) write answers blocked and
// the client falls back to .ics plus Add-to-Google-Calendar links.
export async function POST(req: Request): Promise<NextResponse> {
  let userId: string;
  try {
    ({ userId } = await resolveUser());
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'Give it a minute and try again.' }, { status: 503 });
    }
    throw err;
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.provider_token ?? null;
  const db = await repo();
  const out = await runCalendarSync(
    {
      getToken: async () => token,
      upsertLedger: (rows: SyncLedgerRow[]) => db.syncLedger.upsert(userId, rows),
      fetchImpl: fetch as unknown as SyncFetch,
    },
    (body ?? {}) as { title?: unknown; deadlines?: unknown; portalUrl?: unknown },
  );
  if (!out.ok && out.reason === 'error') return NextResponse.json({ error: out.message }, { status: 400 });
  return NextResponse.json(out);
}
