# Mizzou Build Status

## Current milestone: P0 done uncommitted→committed Oct 30 — Supabase-only stores, stateless turns, Google-only auth, error refs + /api/health, DB-backed budgets (commits d2c44bf, 9a97592, 2c9edc5, 869854c + budgets). Human checks now: Supabase/Google/Vercel live wiring, /api/health on Vercel, sign-in flow, acceptance pass. P1 next.

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
- [x] Item 2 (case-01 fix, Oct 28): program_hint `Computer Science (PhD)` in template + reader prompt, label corrected to the true UTC instant `2026-12-16T04:59:59Z`, luxon Eastern-wall-day matcher (`sourceDay`), 13 tests (incl. template↔fixture lock). Rerun case-01 only: **1/1 deadlines**, evidence 14/15, spend $0.0377. Cause of the old 0/1: (a) label stored wall-time-as-UTC across a UTC-midnight boundary + (b) matcher compared UTC calendar days — the reader was already returning the correct date with a correct UTC conversion. Residual: the Jan-2 CS-MS extraction scores `checked: false` because its evidence quote carries no year (multi-part heading) — evidence-year-check follow-up, not scored.
- [x] Item 3 (Oct 28): agent loop skeleton in `packages/core/src/agent/` (`types` + `FileRunStore` + `advance` with turn cap, 80% time guard, gate halt, opId-idempotent resume; 7 tests; core 24/24, tsc clean). UI: `styles/tokens.css` + landing←`Main.html`, signup←`SignUp.html`, home←`Chat.html` (+PlusMenu overlay); home composer hands off to a fresh chat via `?q=`. Web tsc clean. Browser-unverified (no dev server in sandbox); host must eyeball. Pending: panel drawer (menu button visual-only), Google OAuth (temporary guest passthrough), upload inputs (shell only, M7).
- [x] CSS fix, job 1 (Oct 28): home rendered unstyled because `next.config.ts` forced every `*.css` through the Tailwind loader as global CSS — CSS Modules never hashed, so no module class matched. Removed the `turbopack.rules` override (repo has zero `composes` left; verified by search). Deleted `apps/web/.next`. Full `next build` here compiles all CSS clean; it stops only at `next/font` fetching Google Fonts (sandbox offline — works on an online host).
- [x] Responsive shell, job 2 (Oct 28): new `AppShell` (`app/app/layout.tsx`) — drawer under 768px, pinned 304px panel + centered ~760px chat column at 768px+, right evidence rail at 1100px+. Panel drawer←`Panel.html` (demo reminders/chats, Clear-all+5s Undo, Settings, user row) + logout modal←`Logout.html` (Log out → landing). Requirements rows gained underlined "Where I found this" (Review.html pattern) showing the quote inline and feeding the rail; chat payload now carries `evidence_quote`/`source_url`. PROMPT.md §8 updated to the responsive rule (left uncommitted — user commits PROMPT.md). Web tsc clean. Browser-unverified (no dev server in sandbox); host must eyeball all three breakpoints.
- [x] Fixtures for case-02–10, job 3 (Oct 28, $0 model spend — fetch only): 10 fixtures saved (`case-03/06/07/08/09/10.html` + `case-03-faq`, `case-06-faqs`, `case-07-program`, `case-09-recruitment` subpages). case-02/04/05 timed out after 25s from the sandbox (no fixture — fetch on host or paste). case-10 confirmed JS-shell ("Trackr" only, 15KB) → paste-text behavior recorded. Label-relevant corrections: OIST fee is **5,000 JPY**, not 30 USD; TIIP deadline "15th Dec.–15th Jan." shows **no year** (null + needs_human, not 2026-01-15); case-06 main page is a faculty project page with **no dates/rules** (hard rules likely at entry-requirements, unfetched — one-subpage limit); CERN page shows **no January/November dates** (null + check-again stands). No expected values written; `case-seeds.json` left uncommitted (your file).
- [x] Fresh-state rule + responsive step 1 (Oct 28, $0 model): PROMPT §2 non-negotiable added ("starts fresh…", uncommitted — you commit PROMPT.md). Audit table in chat. Replaced ALL demo strings with real state: file-backed reminders/chats stores (same shapes as the Supabase tables; swap at M7), per-browser anon id cookie + middleware, greeting uses the real name / "Howdy" for guests, empty states everywhere, logout modal via portal (drawer has backdrop-filter), conversation `?q=` creates the chat titled from the first message. Permanent guard test `packages/core/src/guard/no-demo-data.test.ts` fails on John/Fulbright/Yale/Chevening/day-counts (core 25/25). Shell is now the RESPONSIVE.md grid (no max-width on `.mz-shell`; `.mz-narrow` holds landing/signup until step 2): drawer <768, 72px rail + 304px overlay on tablet, pinned 288px (collapsible) + on-demand 360px rail on desktop, chat column 680/760/800. Cards lost backdrop blur above mobile per §3. Two deviations noted: sidebar-collapse interpretation (rail-in-flow on tablet per wireframe) and 28px radii kept over §6's 24px (doc's own tokens/html rule wins). Web tsc clean; browser-unverified — screenshots requested below.
- [x] Corrections step 1 (Oct 28, $0 model): `cacheComponents: false` (+ `partialPrefetching: false`, which requires it) in `next.config.ts` — the async `/app` layout reads the anon cookie, so static prerendering hit "uncached data during prerendering"; classic dynamic rendering removes the error class (Suspense-shell alternative recorded as post-demo optimization). `middleware.ts` renamed to `proxy.ts` (Next 16 convention). Typecheck clean; `next build` compiles all routes and CSS with no prerender/proxy errors — it stops only at Google Fonts fetch (sandbox offline; works on host). `.next` removed again after the attempt.
- [x] Corrections step 2 (Oct 28, $0 model): shell rewritten to the UI_CORRECTIONS spec — single centered column (full-width mobile, 680px tablet, 760px desktop/800px at 1600+), fixed 56px top bar, menu as overlay-only panel on ALL devices (full-height drawer <768, floating 360px/320px cards above; scrim z-40, panel z-50, portal logout modal z-70). Deleted: pinned sidebar, 72px rail, collapse button, evidence rail + all `--sidebar/--panel` vars and pinned media queries; `TopBar` removed from `chrome.tsx` (shell owns the one bar); `.mz-hide-wide` removed from tokens. Causes found: (1) ghost new-chat icon = old global TopBar rendered absolutely inside every column while the new shell rendered its own bar — one shell-owned TopBar now; (2) ~640px left-shift/clip = nested max-width + margin-inline auto inside a full-width shell plus unclipped blobs — `.mz-shell` is now background-only (no max-width) and clips overflow, columns cap themselves. Bar-position bug caught in re-read (bar sat 56px low; now top:0, height 56px+safe-area). Core 25/25, web tsc clean; re-read at 390/640/820/1440 — no fixed widths, no z-overlaps. Browser-unverified: STOPPED for host screenshots (step 2 URLs/widths below), do not start step 3 until confirmed.
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
- Item-2 rerun estimate (stated BEFORE the run): < $0.05 for one reader call on the saved fixture (at most one repair retry). Actual: **$0.0377** (case-01, 1/1). Cumulative paid-model spend now **≈ $0.173** (cap $10). First attempt spent $0.00 (import error before any model call).
- M4 step-1 estimate (stated BEFORE the run): one minimal-effort `/v1/responses` call with `web_search` ≈ **< $0.01** (~$0.0005 model + ~$0.0025 per-query search). Actual: in 2152 + out 171 → model **$0.0034**; no search line item in `usage` (dashboard-side). Cumulative paid-model spend now **≈ $0.176** (cap $10). Shape recorded in `docs/META_API_NOTES.md` §3.
- M4 step-3 smoke estimate (stated BEFORE the run): orchestrator over the saved case-01 fixture, file-backed fetch, 2 real reader calls ≈ **< $0.05** (≈ $0.02). Actual: 2 turns, 2 pages read, 11 deadlines found (5 + 6, same text twice — dedup is step 4), finished `done` with SAY_GOT_IT → model **$0.0376**. Cumulative paid-model spend now **≈ $0.214** (cap $10). First pass stopped after 1 turn on the 80%-of-deadline guard and resumed cleanly on pass 2, which also exercised the resume path.
- Function-tool probes estimate (stated BEFORE the run): 2 tiny calls ≈ **< $0.01**. Actual: 4 tiny calls (echo tool + continuation, then re-run with `previous_response_id`) → model **≈ $0.007**. Cumulative paid-model spend now **≈ $0.221** (cap $10). Shape recorded in `docs/META_API_NOTES.md` §5.
- Model-driven fixture-test estimate (stated BEFORE the run): real model-driven loop on saved case-01 fixture, maxPages 2 ≈ **< $0.10** (~$0.05 expected: ~4 orchestrator turns + 2 reader calls). Actual: 6 turns, 2 pages read, 5 unique deadlines, status `done` → model **$0.0597** (4 orchestrator calls $0.0193 + 2 reader calls $0.0404). Cumulative paid-model spend now **≈ $0.281** (cap $10). Per-turn ledger printed by `.tmp-m4fix/fixture-test.mjs` (probe dir removed after the run).
- M4 step-6 estimate (stated BEFORE the run): fixture-only deep eval on case-01 + case-03 ≈ **< $0.15** (≈ $0.06 + ≈ $0.06). Actual per-turn-ledger sums: case-01 pass 1 **$0.0316**, case-03 **$0.0690**, case-01 confirm pass **$0.0427** = **≈ $0.143**. case-01 deep scan matches the single-page baseline (deadlineHit true = baseline 1/1; 6/6 deadlines checked, baseline was 14/15 over all fields so denominators differ; zero needs_human, zero conflicts, no judge call needed). case-03 (unlabeled, reported raw): 2 pages read, Nov 1 2026 deadline with exact quote, 6 documents, 6 hard eligibility rules, 0 conflicts; 3 unsaved subpages recorded unreadable with links. Pass 1 ended `done` with a transient `orchestrator unreachable` after 3 flaky transport calls (result itself was complete); the code now records the last transport error and the scalar `usageUsd` was fixed to include orchestrator turns (ledger sums are the true costs). Harness: `packages/eval/src/deep.ts` (`pnpm deep`, fixture-only). Cumulative paid-model spend now **≈ $0.424** (cap $10).
- AGENT_BRAIN step-2 probe estimate (stated BEFORE the run): 3 live messages ≈ **< $0.10**. Actual billed **≈ $0.40** — the estimate covered one clean pass, but provider 400s forced 4 diagnostic re-runs plus a chain-shape experiment (all failed calls bill $0; only completed turns count). Findings: (1) chaining onto a gate-ended response 400s ("No tool output found" without outputs, "referenced response not found" with) — the turn now restarts the chain after a gate with a text recap (program URL, pages read, open gate); (2) cross-turn chains flake nondeterministically even onto seconds-old text responses — round 0 retries once without `previous_response_id`; (3) mixed `function_call_output` + message input arrays ARE accepted (proven by experiment), so the shape was never the bug. Final green pass (2 msgs): link → fetch_page + read_page + reader extraction ($0.0235) + coverage card ($0.0498); decision line → chained fine, fit question ($0.0155); total **$0.0653**. Per-turn usage printed by `.tmp-probe-step2.mjs` (scratch, removed after the run). Cumulative paid-model spend now **≈ $0.82** (cap $10).

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
