-- Abuse counters for no-signup caps (per-IP daily runs, per-minute hits).
-- Keyed counters with a window start; routes increment through the
-- service role only. RLS is enabled with no policies: only the service
-- role (which bypasses RLS) reads and writes. Safe to re-run.
create table if not exists rate_counters (
  key text not null, -- ip:<sha256>:run | ip:<sha256>:hit (raw IPs never stored)
  window_start timestamptz not null, -- UTC day / minute start
  count integer not null default 1,
  primary key (key, window_start)
);
alter table rate_counters enable row level security;
