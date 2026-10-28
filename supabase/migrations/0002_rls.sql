-- Mizzou RLS (PROMPT.md sections 9.1, 9.4).
-- Every table has RLS enabled. Owner-only access: user_id = auth.uid().
-- Anonymous sign-in issues a real auth.uid, so guests are isolated
-- by the exact same policies (plus an is_sample profile + Forget me).
-- Cache table `pages` holds only public page text: authenticated users
-- may read it; only the service role writes.
-- Safe to re-run (policies are dropped first).

-- ------------------------------------------------------- RLS on, all tables
alter table chats enable row level security;
alter table messages enable row level security;
alter table runs enable row level security;
alter table pages enable row level security;
alter table extractions enable row level security;
alter table opportunities enable row level security;
alter table decisions enable row level security;
alter table drafts enable row level security;
alter table reminders enable row level security;
alter table tasks enable row level security;
alter table sync_ledger enable row level security;
alter table usage enable row level security;
alter table uploads enable row level security;
alter table profiles enable row level security;

-- ------------------------------------------- owner-only helper (13 tables)
-- One policy set per table; loop keeps them identical and reviewable.
do $$
declare
  t text;
  tables text[] := array[
    'chats', 'messages', 'runs', 'extractions', 'opportunities',
    'decisions', 'drafts', 'reminders', 'tasks', 'sync_ledger',
    'usage', 'uploads'
  ];
begin
  foreach t in array tables loop
    execute format('drop policy if exists owner_all on %I', t);
    execute format(
      'create policy owner_all on %I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t
    );
  end loop;
end $$;

-- profiles is keyed BY user_id (primary key), same rule, own policy name.
drop policy if exists owner_profile on profiles;
create policy owner_profile on profiles for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------- pages: shared read cache
-- No user_id column by design. Everyone signed in (incl. anonymous
-- guests) reads; only the service role (bypasses RLS) writes.
drop policy if exists pages_read on pages;
create policy pages_read on pages for select to authenticated using (true);

-- --------------------------------------- private uploads bucket (storage)
-- Objects live at "<user_id>/<upload_id>.<ext>"; owners touch only
-- their own folder. Bucket itself is private (see 0001).
drop policy if exists uploads_owner_read on storage.objects;
create policy uploads_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'uploads' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists uploads_owner_write on storage.objects;
create policy uploads_owner_write on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists uploads_owner_update on storage.objects;
create policy uploads_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'uploads' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'uploads' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists uploads_owner_delete on storage.objects;
create policy uploads_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'uploads' and auth.uid()::text = (storage.foldername(name))[1]);
