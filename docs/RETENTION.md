# Anonymous retention

No signup required means anonymous users accumulate. Idle anonymous users
are deleted after 7 days, with all their rows, by
`supabase/migrations/0004_retention.sql`.

## What gets deleted

`cleanup_idle_anonymous_users()` deletes from `auth.users` where
`is_anonymous = true` and the last sign-in (or creation, whichever the
row carries) is older than 7 days. Every user table references
`auth.users (id) on delete cascade`, so one delete removes the user's
chats, messages, runs, decisions, drafts, reminders, tasks, opportunities,
extractions, usage rows, uploads metadata, profiles and sync-ledger rows.
Linked (Google) users are never matched. The function returns the deleted
count for logging.

## How to enable (pick one)

Apply migrations in order first (`0001`–`0004`); the function alone does
nothing until something calls it daily.

A. **Supabase pg_cron.** Enable pg_cron for the project, uncomment the
`cron.schedule` select at the bottom of `0004_retention.sql`, re-apply.
Runs daily 03:00 UTC as `mizzou-cleanup-anon`.

B. **Supabase scheduled Edge Function.** Deploy a function on a daily
schedule that calls `supabase.rpc('cleanup_idle_anonymous_users')` with
the service role key and logs the returned count.

C. **External cron.** Point a daily Vercel cron job or GitHub Actions
schedule at an authenticated cleanup route; the route calls the function
with the service role key and logs the returned count.

## Verify

Call `select public.cleanup_idle_anonymous_users();` once from the SQL
editor: it returns `0` on a fresh project (nothing idle yet) and deletes
nothing that is still active. The query contract is pinned by
`supabase/retention.test.ts` (run: `node --test supabase/retention.test.ts`).
