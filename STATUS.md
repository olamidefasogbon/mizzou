# Mizzou Build Status

## Current milestone: M2 started (eval skeleton in place, labeling pending)

- [x] M0: Monorepo scaffolded (`apps/web`, `packages/core`)
- [x] M0: TypeScript setup (`tsconfig.base.json`, per-package configs) + workspace deps
- [x] M0: Zod schema implemented (`ExtractionSchema`)
- [x] M0: `.env.example` committed (no secrets in repo)
- [x] M1: Meta API client wrapper (`callModel.ts`) — single repair retry, 429 backoff (max 3 attempts)
- [x] M1: Role registry (`registry.ts`, env-overridable)
- [x] M1: Usage logging + cost math (`pricing.ts`, Spark $1.25/$4.25 per 1M)
- [x] M1: Budget guard (`budget.ts`) — per-user/global/guest limits from env, friendly "I need a minute." on hit
- [x] M1: Evidence post-check (`evidence.ts`) covers ALL fields (program, opens, deadlines, documents, eligibility, people, tests, money, unusual_rules) + date-year support check
- [x] M1: Unit tests (13 passing, mocks only) + `typecheck` clean
- [x] M2: Eval CLI skeleton (`packages/eval`, `--limit` default 2, skips unlabeled) + cases README + template
- [ ] M0: Day-one checks → `docs/META_API_NOTES.md` created, all 7 items PENDING (need key + live calls)
- [ ] M0: Supabase + Vercel wiring (needs human project setup)
- [ ] M2: 10 hand-labeled cases (human task — template + README ready)
- [ ] M2: Model-backed baseline run (needs labeled cases + approval; estimate below)

## Spend (hard cap: $10 total)

- Cumulative paid-model spend: **$0.00**. No live model calls made in this turn
  (tests use mocks; typecheck/eval skeleton run zero network calls).
- Next paid step (M2 baseline, 2 cases, reader role): estimate ~$0.01–0.03 total
  at Spark prices — under the $0.25 single-run approval line, but will still
  confirm before running since it needs the repo key.
- A full 10-case baseline would be ~$0.05–0.15; full run only on your say-so.

## Decisions

- Doc/code env-name conflict: PROMPT.md section 4 says `MODEL_API_KEY`, code
  used `META_API_KEY`. Documented name wins — `client.ts` now prefers
  `MODEL_API_KEY` with `META_API_KEY` fallback; `.env.example` updated.
- `.env.example` pins dev budget limits per spend rules: PER_USER_DAILY_USD=0.50,
  GLOBAL_DAILY_USD=5, GUEST_RUNS_PER_DAY=3 (code defaults stay at spec 1.00/15/3).
- Where the brief conflicts with itself, sections 5 and 11 win (per brief).
- `packages/core/packages/core/` nested duplicate is pre-existing scaffold junk;
  left untouched, cleanup candidate for later.

## Next

1. You: run day-one checks (needs key) or hand me results → I record them in `docs/META_API_NOTES.md`.
2. You: hand-label eval cases (or point me at 2 pages to fixture for a --limit 2 baseline).
3. Then: M3 thin vertical slice.

## Blockers / Questions

- Need repo key access (never in chat/files) + Supabase/Vercel project wiring before any live call.
- Registry unreachable from this machine, so the first networked `pnpm install` must run with `--no-frozen-lockfile` once to register `packages/eval` in the lockfile. (Lockfile left untouched here; `tsx` was dropped from eval deps so everything it needs is already cached.)
- `.pnpm-store/` in the repo root is local pnpm churn from the failed installs — untracked, do not commit.
