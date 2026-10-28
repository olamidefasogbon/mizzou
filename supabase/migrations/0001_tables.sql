-- Mizzou initial schema (PROMPT.md section 9.1).
-- 14 tables. Safe to re-run (IF NOT EXISTS throughout).
-- Apply 0001_tables.sql first, then 0002_rls.sql.

-- gen_random_uuid() lives in pgcrypto; Supabase enables it by default,
-- but keep this harmless if it is already there.
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- chats
create table if not exists chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New chat',
  deleted_at timestamptz, -- soft delete: 5s Undo window, then hard delete
  created_at timestamptz not null default now()
);

-- --------------------------------------------------------------- messages
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chat_id uuid not null references chats (id) on delete cascade,
  run_id uuid, -- set once the agent loop (M4) owns the run; nullable until then
  role text not null check (role in ('user', 'assistant', 'status', 'card', 'error')),
  text text not null default '',
  data jsonb not null default '{}', -- card payloads, status state, error links
  created_at timestamptz not null default now()
);
create index if not exists messages_chat_id_idx on messages (chat_id, created_at);

-- ------------------------------------------------------------------ runs
-- Section 5.3 run state: one row per agent run, resumable across timeouts.
create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chat_id uuid references chats (id) on delete cascade,
  status text not null default 'running'
    check (status in ('running', 'needs_approval', 'done', 'failed')),
  step integer not null default 0,
  messages jsonb not null default '[]', -- full model message history
  state jsonb not null default '{}',    -- confirmed program, pages, extraction, fit, plan, drafts
  pending_gate jsonb,                   -- { gate, what, evidence, options } while halted
  turn_count integer not null default 0,
  usage_usd numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists runs_chat_id_idx on runs (chat_id, created_at);

-- ----------------------------------------------------------------- pages
-- Shared fetch cache: public page text only, NO user data, NO user_id.
-- RLS (0002) allows authenticated reads; writes are service-role only.
create table if not exists pages (
  url_hash text primary key, -- sha256 hex of the canonical URL
  url text not null,
  title text not null default '',
  page_text text not null default '',
  links jsonb not null default '[]',
  fetched_at timestamptz not null default now()
);

-- ------------------------------------------------------------ extractions
create table if not exists extractions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  run_id uuid references runs (id) on delete cascade,
  url_hash text references pages (url_hash) on delete set null,
  extraction jsonb not null, -- validated Extraction payload incl. checked flags
  created_at timestamptz not null default now()
);
create index if not exists extractions_run_id_idx on extractions (run_id);

-- ----------------------------------------------------------- opportunities
create table if not exists opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chat_id uuid references chats (id) on delete set null,
  run_id uuid references runs (id) on delete set null,
  name text not null,
  unit text not null default '',
  institution text not null default '',
  portal_url text,
  language_read text not null default 'en',
  source_urls jsonb not null default '[]', -- citation URLs that confirmed this program
  status text not null default 'tracking' check (status in ('tracking', 'applied', 'parked')),
  created_at timestamptz not null default now()
);
create index if not exists opportunities_user_id_idx on opportunities (user_id, created_at);

-- --------------------------------------------------------------- decisions
-- Human gate decisions. (user_id, op_id) is unique so a repeated
-- client opId returns the stored row instead of deciding twice (5.3).
create table if not exists decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  run_id uuid references runs (id) on delete set null,
  gate text not null check (gate in ('G1', 'G2', 'G3', 'G4', 'G5')),
  decision jsonb not null, -- { choice, edits? } plus appended tool-result context
  op_id text not null,     -- client-generated idempotency key
  decided_at timestamptz not null default now(),
  unique (user_id, op_id)
);

-- ----------------------------------------------------------------- drafts
-- Versioned drafts (G5). Each edit keeps a new row; latest wins.
create table if not exists drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chat_id uuid references chats (id) on delete set null,
  kind text not null check (kind in ('statement', 'email', 'answer')),
  title text not null default '',
  body text not null default '',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  unique (user_id, kind, version)
);
create index if not exists drafts_chat_id_idx on drafts (chat_id, kind, version);

-- --------------------------------------------------------------- reminders
create table if not exists reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  opportunity_id uuid references opportunities (id) on delete cascade,
  title text not null,
  status_line text not null default '', -- "Statement of purpose, not finished"
  pill text not null default '',        -- "6 days" / "Soon"
  due_at timestamptz,                   -- null for watch-it items (portal opens)
  kind text not null default 'custom'
    check (kind in ('two_weeks', 'opens', 'three_days', 'check_again', 'document', 'custom')),
  snoozed_until timestamptz,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists reminders_user_due_idx on reminders (user_id, due_at) where done = false;

-- ------------------------------------------------------------------ tasks
-- One row per required document (7.3), attached to its reminder where known.
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  reminder_id uuid references reminders (id) on delete set null,
  label text not null,
  done boolean not null default false,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------- sync_ledger
-- One row per calendar event (7.3). event_id is deterministic
-- (lowercase base32hex of the plan hash); a 409 insert = success.
create table if not exists sync_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id text not null, -- deterministic id, never the provider's
  provider text not null default 'google',
  status text not null default 'synced',
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, event_id)
);

-- ------------------------------------------------------------------ usage
create table if not exists usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  run_id uuid references runs (id) on delete set null,
  model text not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  latency_ms integer not null default 0,
  cost_usd numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists usage_user_day_idx on usage (user_id, created_at);

-- ---------------------------------------------------------------- uploads
-- Metadata only; bytes live in the private `uploads` storage bucket (below).
create table if not exists uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chat_id uuid references chats (id) on delete set null,
  kind text not null check (kind in ('flyer', 'pdf')),
  mime text not null,
  size_bytes integer not null default 0,
  storage_path text not null, -- "<user_id>/<upload_id>.<ext>" inside the bucket
  extracted_text text,        -- user-provided paste or OCR/vision output
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- profiles
-- Only facts the task needs (7.1). Guests get a pre-filled sample profile
-- (is_sample = true) plus a visible Forget me; never store more.
create table if not exists profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  facts jsonb not null default '{}', -- degree, field, institution, country, grades?, interests
  is_sample boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------- private uploads bucket
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', false)
on conflict (id) do nothing;
