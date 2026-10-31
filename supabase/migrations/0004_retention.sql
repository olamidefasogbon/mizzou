-- Anonymous retention: delete idle anonymous users and all their rows.
-- Every user table references auth.users (id) on delete cascade, so
-- deleting the auth user removes chats, messages, runs, decisions, drafts,
-- reminders, tasks, opportunities, extractions, usage, uploads metadata,
-- profiles and sync_ledger rows in one go. Only is_anonymous users idle
-- for 7 full days are touched; linked (Google) users are never matched.
--
-- Enable by schedule (pick ONE):
--   A) Supabase pg_cron: enable pg_cron for the project, then uncomment
--      the cron.schedule select at the bottom of this file and re-apply.
--   B) Supabase scheduled Edge Function: deploy a function that calls
--      supabase.rpc('cleanup_idle_anonymous_users') on a daily schedule
--      with the service role key.
--   C) External cron (Vercel cron, GitHub Actions scheduler): call an
--      authenticated cleanup route daily; the route calls the function
--      with the service role key and logs the returned count.
-- Safe to re-run (create or replace throughout).

create or replace function public.cleanup_idle_anonymous_users()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer := 0;
begin
  with gone as (
    delete from auth.users
    where is_anonymous = true
      and coalesce(last_sign_in_at, created_at) < now() - interval '7 days'
    returning id
  )
  select count(*) into removed from gone;
  return removed;
end;
$$;

-- Daily 03:00 UTC via pg_cron. Uncomment after enabling pg_cron, re-apply.
-- select cron.schedule(
--   'mizzou-cleanup-anon',
--   '0 3 * * *',
--   $$select public.cleanup_idle_anonymous_users()$$
-- );
