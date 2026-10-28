# Mizzou gap report (audit, Oct 28, 2026)

Method: read-only audit, zero model spend. Compared every built file against
PROMPT.md and against `docs/design/html/*.html` (exact CSS values) plus the
nine PNGs. Section 5 and 11 win internal PROMPT conflicts; where PROMPT §8 and
the HTML differ, the HTML wins; the wordmark is Pinyon Script via
`next/font/google` (user instruction + `docs/design/README.md`).
No dev server can run in this sandbox, so the built UI is verified by
code-to-HTML comparison only — see "Browser verification" at the end.

## (a) Built and matches the spec

| # | Item | Evidence |
|---|---|---|
| A1 | M0 monorepo scaffold, pnpm workspace, `tsconfig.base.json`, per-package configs, `.env.example` (no secrets) | repo root, `packages/*`, `apps/*` |
| A2 | `callModel` wrapper: one repair retry, 429 backoff (max 3 attempts), zod-validated structured output | `packages/core/src/meta/callModel.ts` |
| A3 | Role registry, env-overridable, Spark 1.3 defaults + voice-transcribe model name | `packages/core/src/meta/registry.ts` |
| A4 | Usage/cost math (Spark $1.25/$4.25 per 1M) + budget guard (per-user/global/guest, "I need a minute.") | `packages/core/src/meta/{pricing,budget}.ts` |
| A5 | Extraction schema + evidence post-check over all fields incl. date-year support | `packages/core/src/schemas/extraction.ts`, `packages/core/src/extract/evidence.ts` |
| A6 | Eval CLI baseline (single page, `--limit 2`, skips unlabeled, writes `docs/EVAL_REPORT.md` + `docs/eval-results.json`), raw-deadline persistence + scoring tests | `packages/eval/src/{run,scoring}.ts` |
| A7 | `POST /api/chat` streams the shared `RunEvent` contract (message/status/needs_approval G1/card/done/error share types with the client) | `apps/web/src/app/api/chat/route.ts`, `packages/core/src/schemas/events.ts` |
| A8 | URL in → single-page fetch + reader extraction → G1 program card; requirements + plan cards buffered until G1 "Yes"; plan download posts to the ICS route | same as A7 + `app/app/c/[chatId]/page.tsx` |
| A9 | ICS export: deterministic `sha256` UIDs, prep/final-push/deadline events, friendly 400s, correct headers | `apps/web/src/app/api/calendar/ics/route.ts` |
| A10 | Voice microcopy module (most §8.3 lines, first-person, no jargon/emoji) | `packages/core/src/voice/index.ts` |
| A11 | Meta day-one checks 1–2 verified with examples; spend log under the $10 cap | `docs/META_API_NOTES.md`, `STATUS.md` |
| A12 | First commit Oct 27, 5 small commits, public-history shape correct | `git log` |
| A13 | Commit `9a54a60` extracted eval scoring unchanged + persists raw deadlines for no-model audits | `packages/eval/src/scoring.ts` |

## (b) Built but differs from the spec or designs

| # | File | Does now | Spec / design says |
|---|---|---|---|
| B1 | `apps/web/src/app/page.tsx` | Untouched `create-next-app` default (Next/Vercel links, dark mode) | §8.2 screen 1: wordmark, "From link to executed application.", glass pill, black "Try it for free", login line |
| B2 | `apps/web/src/app/layout.tsx`, `globals.css` | Geist fonts, Tailwind default tokens, **dark mode** | Pinyon wordmark via `next/font/google`; light-only `#E9E9EB`; tokens live in `styles/tokens.css` (file does not exist) |
| B3 | `app/app/c/[chatId]/page.tsx` header | Plain "Mizzou" text + "New chat" pill, clears feed locally | Top bar: menu button left, Pinyon wordmark center, round new-chat right (Chat.html:23,29) |
| B4 | same, bubbles | User `bg-black/[0.07]`, Mizzou plain white, no gray borders | User `rgba(120,120,128,0.22)` + `1px rgba(60,60,67,0.18)` border, radius `22px 22px 6px 22px`; Mizzou `rgba(255,255,255,0.5)` + same border, radius `22px 22px 22px 6px` (Conversation.html:35,37) |
| B5 | same, cards/composer | White cards `border-black/10`, plain white composer with black send, spinner status rows | Glass cards `rgba(255,255,255,0.42)` + `blur(24px) saturate(180%)` + white border + soft shadow, radius 28; composer glass pill 52px with plus button and gray send (Chat.html:40,72) |
| B6 | same, G1 card | White card, black "Yes, that's it" + gray "Not quite" (shape close) | Glass card radius 28, 46px buttons, program name + "{Department}, {School}" (Conversation.html:56) |
| B7 | same, requirements card | White card, "Documents"/"Eligibility" groups, amber `!` badges, **no source links** | "What they ask for" glass card, ✓/! rows, underlined "Where I found this" per row, unpublished-opens note (Review.html:48) |
| B8 | same, plan card | White card listing raw ISO "Deadline" rows + "Download .ics" black button | "Your reminders" timeline (dots `#6C6C70`, 3 labeled rows) + draft card with edit-prompt bar + "Approve & Sync" (flex 1.5, 54px black) + "Not yet" gray (Approve.html:37,71) |
| B9 | `api/calendar/ics/route.ts` | **POST**, UID `sha256(title\|iso\|kind)` hex, events = prep-14d + push-3d + deadline-day, fixed 09:00 UTC | §3 lists **GET** `/api/calendar/ics`; §7.3 third reminder is **"the day it opens"** (not deadline-day), UID `sha256(userId\|opportunityId\|kind)`, times shown in the user's local timezone |
| B10 | `api/chat/route.ts` | Reader-only slice: fetch + `reader` + evidence check; G1 "Yes" only unhides buffered cards client-side | §5: orchestrator tool loop, G2/G3/G4/G5, `decisions` + `runs` rows, resume-by-`advance`; G1 Yes must continue the run server-side |
| B11 | `voice/index.ts` `formatG1Prompt` default | "…Is this what you mean?" | §8.3 program line: "Quick check before I go further. **Is this the program you mean?**" (+ `SAY_GOT_IT`, `sayLanguageRead` defined but never sent) |
| B12 | `api/chat` + `api/calendar/ics` inputs | Hand-rolled checks, no zod | §9.2: all route inputs/outputs zod-validated |
| B13 | `maxDuration = 60` | Fixed 60s | §9.2: platform maximum (confirm against the Vercel plan at deploy) |
| B14 | `next 16.4.3`, `framer-motion` installed unused, `@supabase/*` installed unused | — | Spec pins Next.js 15; motion only via springs with `prefers-reduced-motion`; Supabase wired in M0/M7 |
| B15 | `STATUS.md` M2 line | Claims evidence 15/15, spend $0.0375 | Latest committed run is 13/14 (stale line; fixed in step 4) |

## (c) Not built yet (PROMPT.md section → milestone)

| # | Item | Spec → milestone |
|---|---|---|
| C1 | Landing, sign-up, home (greeting rotation + Coming up), plus menu, left panel, logout modal — 6 of 9 screens | §8.2 → M8 (M3 shell exists only as the pre-design conversation page) |
| C2 | `signup/page.tsx`, `app/layout.tsx` shell, `app/page.tsx` home, `auth/callback/route.ts`, Google sign-in, guest anonymous session | §3, §7.1, §9.2 → M3/M7 |
| C3 | `api/runs/[runId]/resume`, `advance()` loop, `runs` state, `pending_gate`, `opId` idempotency, `continue` events | §5.3 → M4 |
| C4 | Orchestrator + tools (`fetch_page`, `find_links`, `read_pdf`, `read_page`, `request_approval`, `finish`), 12-turn/25-page caps | §5.1 → M4 |
| C5 | Search grounding + citations, link ranking (code), parallel fetch, PDF reading, robots/rate-limit, 24h caches | §4–§5.1, §9.3 → M4 |
| C6 | Deep scan config in eval + judge reconcile + G2 + coverage card (incl. "wouldn't open" + language-read lines) | §6.3–§6.5 → M4 |
| C7 | Profile-by-conversation (G3), internal fit + "Want to go for it anyway?" + "Yes, let's apply"/"Not now" + `decisions` | §7.1–§7.2 → M5 |
| C8 | Flyer upload route + `vision` role (1600px compress, same schema) | §4, §6.1 → M5 |
| C9 | Drafts (G5), chat edits, versions, Application Pack screen (checklist, copy-ready answers, recommender/registrar emails, portal button) | §7.5–§7.6 → M6 |
| C10 | Google Calendar sync route, incremental consent, idempotent base32hex event ids, `sync_ledger`, Approve & Sync flow | §7.3 → M7 |
| C11 | `api/reminders`, `api/chats` (list/clear-all+Undo), `api/upload`, `api/transcribe`, Coming up + panel reminders, talk-back follow-ups, Forget me | §3, §7.4, §9.4 → M7 |
| C12 | Supabase (all 14 tables + RLS), anonymous-guest isolation, 5s-undo hard delete, `usage` table (today: in-memory only) | §9.1, §9.3–§9.4 → M0/M7 |
| C13 | Recorded sample runs (labeled replay fallback for judging) | §9.3 → M8 |
| C14 | Voice notes (60s WAV → transcribe route) and SAM 3.1 evidence regions — both optional/time-boxed | §4, §12 → M9 |
| C15 | 9 more labeled eval cases, role A/B comparisons, final eval run with measured numbers | §10 → M2/M4/M10 |
| C16 | Root README (pitch, live URL, hackathon section, models-used table, eval numbers, costs, limits, licenses), `ARCHITECTURE.md` + diagram, `DEMO_SCRIPT.md`, demo video, submission | §12 → M10 |
| C17 | "Where I found this" quote+source surfacing end to end (evidence exists server-side only) | §2 non-negotiable 4 → M8 |

Counts: (a) 13 rows · (b) 15 rows · (c) 17 rows.

Top 5 gaps by demo risk:
1. **C3/C4 — no resumable agent loop.** Everything gates on `advance()` + `resume`; the built chat route is a one-shot reader. All of M4–M7 hangs off this.
2. **C12 — no database at all.** Runs, gates, decisions, reminders, drafts, usage, profiles, uploads have nowhere to live; G4/G5 and talk-back reminders are impossible without it. (Needs human: Supabase project.)
3. **C1/B1–B8 — six screens missing, three pre-date the designs.** The demo is judged on the Liquid Glass UI; the current pages share almost no CSS with `docs/design/html`.
4. **C7/C9 — no fit read, no drafts, no Application Pack.** The core loop steps 5–7 (§2) have no UI or agent behind them.
5. **C2/C10 — no auth, no guest path, no Calendar sync.** No sign-in means no demo login, no guest fallback for judges, no G4 payoff shot for the video.

## Cleanup

- `packages/core/packages/core/` — nested scaffold duplicate (own `package.json`, lockfile, `node_modules`); delete, do not commit. (Known since STATUS.md; still present.)
- `.pnpm-store/` at repo root — local install churn, untracked; never commit.
- `apps/web/README.md` + `AGENTS.md` — unmodified `create-next-app` boilerplate (the Next-16 agent-rules block re-adds itself; leave it, replace README at M10).
- `pnpm-lock.yaml` is stale for the `vitest ^5.0.5` eval devDep (added while `pnpm` is unusable in this sandbox); run `pnpm install` on the host to reconcile.
- Spec/HTML conflicts resolved for the build: HTML wins on any CSS number (§8.1 vs HTML); wordmark is Pinyon Script via `next/font/google` (§8.1's SVG line is superseded by user instruction + design README); ICS route stays POST despite §3's GET label (POST carries the approved plan body; record the deviation in `ARCHITECTURE.md` at M10).

## Design tokens (copy source: `docs/design/html/*.html`)

Page `#E9E9EB`; blobs `#CFCFD4` / `#C4C4CA` / `#F7F7F9` at blur 60–70px; text `#000`, secondary `#48484A`; glass `rgba(255,255,255,0.42)` + `blur(24px) saturate(180%)` + `1px rgba(255,255,255,0.7)` border + shadow `0 0 0 0.5px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,0.85), 0 10px 30px rgba(0,0,0,0.07)`; radius 28 cards / capsule controls; hairline `rgba(60,60,67,0.14)`; pills `rgba(120,120,128,0.2)`; black only on the single primary action; wordmark Pinyon 88px landing / 68px signup / 42px top bar / 38px panel; 44px minimum touch targets; `a/button:active opacity 0.72`. Single home for these values in the build: `apps/web/src/app/styles/tokens.css` (to be created).

## Browser verification

Playwright Chromium binaries exist in this sandbox, so a headless screenshot probe of `docs/design/html/Chat.html` was launched — it was still running at commit time. The built app itself cannot be served here (no listening sockets), so the built UI is **unverified in a browser**: this audit rests on line-by-line code-to-HTML comparison above. Host must eyeball every restyled screen in a real browser (see STATUS.md plan).
