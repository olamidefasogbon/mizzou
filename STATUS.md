# Mizzou Build Status

## Current milestone: audit done (`docs/GAP_REPORT.md` committed) — build queued to the Nov 4 deadline

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
- [x] M2: Baseline report written (`docs/EVAL_REPORT.md`, `docs/eval-results.json`): 0/1 deadlines, recall 33.3%, precision 100.0%, evidence 13/14, spend $0.0305
- [x] Audit (Oct 28, no model spend): `docs/GAP_REPORT.md` — 13 built-and-matching, 15 built-but-differs, 17 not-built; top risks are the missing agent loop, missing DB, and the pre-design UI
- [x] M3: `POST /api/chat` streams the real RunEvent contract (message/status/needs_approval G1/done/error); URL in → live single-page extraction → G1 program card, verified end to end
- [x] M3: Conversation page (`app/app/c/[chatId]`) with streaming status lines, G1 confirm card, and sample .ics download; typechecks clean (browser render not yet eyeballed — no browser tooling here)
- [x] M3 remainder: Requirements Card (document checklist + eligibility with ✓/needs-a-look flags) and Reminder Plan Card stream as `card` events, shown only after G1 Yes; plan Download button POSTs the extracted schedule to the new ICS route
- [x] M3: `POST /api/calendar/ics` builds a valid `.ics` download (prep/push/deadline events, deterministic UIDs, friendly 400s); verified live: 9 events, correct headers
- [ ] M3: anonymous guest session (needs Supabase wiring — human setup)
- [x] Core: `schemas/events.ts` (RunEvent + SSE encoder, shared with client) and `voice/` microcopy modules added; `@mizzou/core` linked into web
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
- M3 smoke estimate (written BEFORE the run): one live `/api/chat` pass =
  fetch (free) + one reader extraction ≈ **< $0.05**, same shape as the
  $0.0375 baseline.
- M3 smoke actual: vague-input path $0.00 (2 events, no model call); live URL
  pass ≈ **$0.04** (same shape as baseline; usage not printed by the route).
  Cumulative paid-model spend now **≈ $0.095**.
- M3 remainder estimate (written BEFORE the run): one more live `/api/chat`
  pass to verify the new card events ≈ **< $0.05**; the `.ics` route test is
  free (no model calls).
- M3 remainder actual: live pass with card events ≈ **$0.04**; ICS route test
  $0.00. Cumulative paid-model spend now **≈ $0.135** (cap $10).

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

## Next — single ordered list to a complete demo (submit by midday Lagos Nov 4; hard deadline Nov 4, 9:00 PM ET)

Do these in order; each line lands as its own commit. Items marked YOU run in
parallel with the agent lines — start them today.

1. YOU (today): Supabase project + Google OAuth + apply `supabase/migrations/` (SQL written + committed Oct 28, 14 tables + RLS + private bucket; see apply steps in chat); Vercel project linked. Unblocks 5, 8, 9.
2. YOU (today–Oct 30): 9 more hand-labeled cases (or URLs to fixture). Unblocks 7.
3. Agent (Oct 28–29): M4 agent loop — `advance()`, tools, gates G2/G3, search grounding, deep scan + budget, judge reconcile, coverage card, resume route. Depends on 1 for persistence (ship file-backed first, swap to Supabase when ready).
4. Agent (Oct 29–30): `styles/tokens.css` + restyle landing/signup/home/conversation to the nine PNGs via `docs/design/html` values (Pinyon wordmark, glass, 44px targets). Host eyeballs each screen.
5. Agent (Oct 30): M5 profile/G3 + fit card + "go for it anyway" + flyer upload/vision.
6. Agent (Oct 31): M6 drafts/G5/versions + Application Pack screen.
7. Agent (Nov 1): eval deep-scan config on all 10 cases + role A/B picks (needs 2).
8. Agent (Nov 1): M7 Google sign-in/guest session, Calendar sync + `.ics` fallback, reminders/chats/upload APIs, Coming up + panel + talk-back.
9. Agent (Nov 1–2): M8 panel/logout/Clear-all-Undo, budgets caps, recorded runs, "Where I found this" end to end.
10. Agent (Nov 2): M9 voice + SAM 3.1 time-boxed — ship or cut, no carryover.
11. Agent (Nov 3): M10 README, ARCHITECTURE.md + diagram, DEMO_SCRIPT.md, final eval run, demo video shots, submission + reopen-verify.
12. Nov 4: buffer only.

Dropped/merged: old "M3 leftovers" folded into 4 and 8; per-case raw JSON already shipped (`9a54a60`).

## Blockers / Questions

- YOU: Supabase/Vercel project wiring (item 1) before any app-surface work.
- YOU: labeled cases (item 2) before the full eval (item 7).
- This sandbox forbids listening sockets (`next dev` gets EACCES even on
  127.0.0.1), so the dev server could not run here — routes were verified
  by invoking handlers directly, pages by typecheck + code-to-HTML
  comparison only. Host eyeball pass required for every screen (item 4).
- `.pnpm-store/` in the repo root is local pnpm churn from the earlier failed
  installs — untracked, do not commit.
