# Mizzou Build Status

## Current milestone: M2 baseline run done on 1 labeled case

- [x] M0: Monorepo scaffolded (`apps/web`, `packages/core`)
- [x] M0: TypeScript setup (`tsconfig.base.json`, per-package configs) + workspace deps
- [x] M0: Zod schema implemented (`ExtractionSchema`)
- [x] M0: `.env.example` committed (no secrets in repo)
- [x] M0: Day-one checks → `/v1/responses` + chat-completions paths VERIFIED, response structures recorded in `docs/META_API_NOTES.md` (search/streaming/image/SAM still pending; $150 credit is dashboard-side)
- [x] M1: Meta API client wrapper (`callModel.ts`) — single repair retry, 429 backoff (max 3 attempts)
- [x] M1: Role registry (`registry.ts`, env-overridable)
- [x] M1: Usage logging + cost math (`pricing.ts`, Spark $1.25/$4.25 per 1M)
- [x] M1: Budget guard (`budget.ts`) — per-user/global/guest limits from env, friendly "I need a minute." on hit
- [x] M1: Evidence post-check (`evidence.ts`) covers ALL fields + date-year support check
- [x] M1: Unit tests (13 passing, mocks only) + `typecheck` clean (both packages)
- [x] M2: Eval CLI executes the production reader path (`callModel` + zod + post-check), `--limit` default 2, skips unlabeled; 1 labeled case runs clean via `pnpm eval --limit 2`
- [x] M2: Baseline report written (`docs/EVAL_REPORT.md`, `docs/eval-results.json`): 0/1 deadlines, recall 33.3%, precision 100.0%, evidence 15/15, spend $0.0375
- [ ] M0: Supabase + Vercel wiring (needs human project setup)
- [ ] M2: 9 more hand-labeled cases for the full 10-case set (human task)
- [ ] M2: Deep-scan config + role A/B comparisons (needs M4 advance loop)

## Spend (hard cap: $10 total)

- Cumulative paid-model spend: **≈ $0.055**. Every run stayed far under the
  $0.25 single-run approval line (pre-run estimate for this run was < $0.05;
  actual came in at ~$0.053 — over only because the first baseline attempt
  needed a repair + retry after a prompt/schema mismatch I then fixed).
- Day-one probes (3 tiny `/v1/responses` calls, effort high/low/minimal):
  in 13 + out 330/115/15 → **$0.0020** measured.
- Failed baseline attempt (schema mismatch, initial + repair): **≈ $0.015** estimated.
- Successful baseline (case-01, reader, minimal effort): **$0.0375** measured.
- A full 10-case baseline would be ~$0.15–0.40 at these page sizes; full run
  only on your say-so.

## Decisions

- Doc/code env-name conflict: PROMPT.md section 4 says `MODEL_API_KEY`, code
  used `META_API_KEY`. Documented name wins — `client.ts` now prefers
  `MODEL_API_KEY` with `META_API_KEY` fallback; `.env.example` updated.
- `.env.example` pins dev budget limits per spend rules: PER_USER_DAILY_USD=0.50,
  GLOBAL_DAILY_USD=5, GUEST_RUNS_PER_DAY=3 (code defaults stay at spec 1.00/15/3).
- Where the brief conflicts with itself, sections 5 and 11 win (per brief).
- Labeled case URL was dead (`admissions.yale.edu/graduate` → 404); replaced
  with the canonical `gsas.yale.edu/.../dates-deadlines` page (fixture saved
  under `packages/eval/fixtures/` per the fixture-first spend rule).
- Eval runs the production reader (`callModel` + `ExtractionSchema` +
  `verifyExtractionEvidence`), not raw fetch; `run.ts` loads `.env.local`
  into `process.env` (gaps only, never prints values) before importing core.
- Reverted the node:test/`allowImportingTsExtensions`/`.ts`-import experiments:
  `response.ts` + `test/` removed as superseded by the `callModel` refactor.
- `@mizzou/core` now builds to `dist/` (`main: dist/index.js`, `build: tsc -p
  tsconfig.build.json` excluding tests) so workspace bare imports resolve.
- `packages/core/packages/core/` nested duplicate is pre-existing scaffold junk;
  left untouched, cleanup candidate for later.

## Next

1. You: 9 more hand-labeled cases (or point me at pages to fixture).
2. Then: M3 thin vertical slice (needs Supabase/Vercel wiring — human setup).
3. Suggested: persist per-case raw extraction JSON in the eval run so a 0/1
   like case-01's deadline score can be diagnosed without re-spending.

## Blockers / Questions

- Supabase/Vercel project wiring before any app-surface work.
- `.pnpm-store/` in the repo root is local pnpm churn from the earlier failed
  installs — untracked, do not commit.
