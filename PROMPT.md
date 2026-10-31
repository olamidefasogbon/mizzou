# Mizzou: full build prompt

Oct 27, 2026 · @Olamide Fasogbon — finished as the as-built brief, Nov 1, 2026

This is the single brief to hand to your coding agent (Muse Code or any other). Export it as Markdown and save it in the repo root as PROMPT.md. Sections marked **SHIPPED**, **PARTIAL**, or **CUT** describe what actually landed during the event; unmarked requirements still hold.

## 1. How to use this prompt

You are the lead engineer building Mizzou, a solo hackathon project, in a monorepo. Read this whole document before writing code. Everything here is a requirement unless it is marked optional.

**Working rules**

- Work in the milestones in section 11. After each milestone: run it, commit, and update `STATUS.md` with what is done, what is next, and any blocker. All milestones are finished; section 11 records each as **SHIPPED**, **PARTIAL**, or **CUT**.
- Do not ask the human questions unless you are blocked on a secret key or a product decision this document does not cover. Otherwise decide, write the decision in `STATUS.md`, and continue. Product decisions taken during the build: **no signup required** (anonymous sessions for everyone, Google is an optional link that preserves the same user id); stateless model calls with no reasoning replay; 4xx errors fail fast with the full provider message.
- Anything marked **VERIFY** is an assumption about an external service. Confirm it against the official docs or a real call, record the result in `docs/META_API_NOTES.md`, and only then rely on it.
- Prefer the simplest thing that works end to end over the clever thing that works in pieces. A thin vertical slice running by milestone M3 matters more than any single feature.
- Never commit secrets. Use `.env.local` and a committed `.env.example`.

**Hackathon rules you must respect**

- The repository must be public, and the demo may only show work built during the event (Oct 27 to Nov 4, 2026). Make the first commit on or after Oct 27, keep a clean history with small commits, and only use code and assets you have the right to use, following each license.
- The README needs a "Built during the hackathon" section listing what was made, and a section naming every Meta model and tool actually used and where.
- Do not build or claim anything outside this brief. Each feature that ships must be real and visible in the demo.
- The app starts fresh. No hardcoded demo data anywhere in app code. Test data lives only in tests, fixtures and the eval.

**First message to send the agent**

```text
Read PROMPT.md fully. Then start at milestone M0. Keep STATUS.md current. Commit after every milestone. Ask me only if you are blocked on a secret or a product decision the document does not cover.
```

## 2. Product brief and non-negotiables

Mizzou is an autonomous agent that works on opportunities on the user's behalf. Its interface is conversational and responsive (mobile, tablet, desktop), but the product is the agent. A student or early-career professional anywhere in the world says, pastes or photographs the opportunity they want (a scholarship, university or PhD program, job, fellowship, internship, grant or conference). Mizzou finds the official source, reads every relevant page including FAQs and PDFs, extracts dates and requirements with evidence, gives an honest read on fit, builds a reminder plan, drafts the written materials and prepares an application pack. The human approves every step that matters.

**The core loop**

1. Understand what the user wants from a sentence, a link or a flyer photo.
2. Find the official page and confirm it is the right program (gate G1).
3. Deep scan the official site: main page, FAQ, eligibility, guidelines, PDFs, up to the page budget.
4. Extract and reconcile dates and requirements, each with its source.
5. Ask one profile question at a time in chat, only for facts this task needs, then give an honest fit read in plain words and ask "want to go for it anyway?". **PARTIAL:** no standalone fit card and no internal fit score object — the read lives in prose.
6. Propose the reminder plan (Approve & Sync, gate G4) and return draft payloads for review (gate G5). **PARTIAL:** a draft review card ships; draft versions, chat edits, and the Application Pack screen did not.
7. **CUT:** the Application Pack screen (checklist, copy-ready answers, email drafts, portal button) and reminders that talk back on return. The plan card plus the Coming up card cover scheduling.
8. Idle anonymous users and all their rows are deleted after 7 days (migration 0004, `docs/RETENTION.md`).

**Non-negotiables**

1. **Helps, never decides.** Fit is advice. After an honest explanation Mizzou asks one question, "Want to go for it anyway?", and carries on if the answer is yes. It never blocks, never lectures and never asks twice.
2. **Autonomous until a gate.** Read-only and reversible work runs on its own. The run stops for a human only at these gates: G1 program match (always), G2 dates or rules that are uncertain or conflicting (only when flagged), G3 the profile facts used (once), G4 calendar writes, the Approve & Sync button (always), G5 keeping a draft (always).
3. **Never in the MVP:** sending email, submitting a portal application, or logging into any portal as the user.
4. **Evidence for every claim.** Each date and requirement carries a source URL and a short quote. The UI shows only a "Where I found this" link.
5. **The mechanics stay inside.** The UI never shows scores, percentages, probabilities, model names, token counts, schemas, or the words "AI agent". The technical story lives in the README and docs for judges.
6. **Honest uncertainty.** If unsure, say so plainly and ask. If a page would not open, say which one and give the link. If the opening date is not published, say so and create a check-again reminder instead of guessing.
7. **Never invent facts** about the user or the opportunity. Drafts use `[PLACEHOLDER]` for missing facts. Never help misstate credentials.
8. **Voice.** A friendly buddy: short sentences, first person, warm, no jargon, no emoji, no preaching.
9. **Global by default.** Dates always carry a timezone and are shown in the user's local timezone. Do not assume US conventions: grading scales, degree names and application systems vary. The agent may read pages in other languages and should say when it did.
10. **Privacy.** No signup required: first touch mints an anonymous Supabase session, and RLS isolates every user id the same way. Store only what the task needs, offer Clear all chats with a 5-second undo, delete idle anonymous users after 7 days, and never use a training-data (contributor) model mode with personal data. A throwing tool returns a structured `{error}` result to the model; it never ends the run.

## 3. Monorepo structure and stack

Use **one repository, one language (TypeScript), one deploy.** A second backend language would double the setup, the typing and the debugging for a solo builder. The agent lives in a framework-free package so the web app and the evaluation script run exactly the same code.

```text
mizzou/
  PROMPT.md  STATUS.md  README.md  .env.example
  package.json  pnpm-workspace.yaml  tsconfig.base.json
  apps/
    web/                         Next.js 16 (App Router), Tailwind, Framer Motion
      app/
        page.tsx                 Landing (Try opens /app anonymously; Log in is Google-only)
        landing-actions.tsx      TryButton (anonymous session) + LoginButton (OAuth/link)
        turnstile.tsx            Cloudflare Turnstile widget (only when the site key is set)
        app/layout.tsx           App shell: top bar, overlay panel, composer
        app/page.tsx             Home: greeting, Coming up card
        app/c/[chatId]/page.tsx  Conversation (bubbles, tool rows, cards)
        auth/callback/route.ts   OAuth/link callback, honors a validated /app ?next=
        api/chat/route.ts        POST: starts or continues a run, streams events (SSE)
        api/runs/[runId]/resume/route.ts   POST: continue after a gate decision
        api/reminders/route.ts   POST: approve a plan (idempotent reminders + ledger)
        api/calendar/ics/route.ts   POST: .ics for approved plan (public, no auth)
        api/health/route.ts      GET: env presence booleans only
        proxy.ts                 session refresh + silent anonymous minting (no login wall)
      components/                shell, panel (+Guest row), settings-modal, chrome, evidence
      lib/                       auth, anonymous, google-upgrade, plan-sync, caps, repo,
                                 chat-groups, usage, supabase clients, tokens
      app/styles/tokens.css      design tokens from section 8
  packages/
    core/                        no framework imports
      src/meta/                  client, registry, pricing, budget, callModel (chat path),
                                 responses (Responses transport, streaming, retry policy)
      src/agent/                 advance (12-turn loop, 80% time guard), run store, types
      src/conversation/          turn loop (3 rounds), buildInput, chat titles
      src/deepscan/              orchestrator, coverage, fetch, pdf, rank
      src/extract/               reader schema, evidence post-check, reconcile + judge
      src/guard/                 no-demo-data source scan
      src/prompts/               orchestrator/reader/judge prompts (md + builders)
      src/schemas/               events (SSE contract), extraction
      src/voice/                 microcopy: every user-facing string the agent emits
    eval/                        CLI: labeled cases, baseline vs deep scan, report
      cases/                     one JSON file per labeled opportunity (case-01 labeled)
  supabase/migrations/           0001 tables, 0002 RLS, 0003 rate_counters, 0004 retention
  docs/                          META_API_NOTES.md RETENTION.md EVAL_REPORT.md
                                 design/: FIXLIST.md AGENT_BRAIN.md META_STYLE.md
                                 RESPONSIVE.md UI_CORRECTIONS.md README.md
```

| Layer | Choice | Notes |
| --- | --- | --- |
| Web | Next.js 16, React, TypeScript, Tailwind CSS, Framer Motion | Mobile first. Respect reduced motion. |
| Server | Next.js route handlers, Node runtime | SSE for live progress. Set `maxDuration` to the platform maximum. |
| Agent core | `packages/core`, plain TypeScript | The only place that talks to Meta models. |
| Models | Meta Model API through the `openai` npm package with `baseURL` set to `https://api.meta.ai/v1` | Documented as drop-in compatible with the OpenAI SDK. If a needed feature is not exposed by the SDK, call the REST endpoint with `fetch`. |
| Database and auth | Supabase: Postgres, anonymous sessions, optional Google link, row level security | No signup required; guests are anonymous users, linking preserves the id. |
| Validation | `zod` | Every model output is parsed. One repair retry, then a graceful fallback. |
| Page reading | `cheerio` plus `@mozilla/readability`; `unpdf` for PDFs | No headless browser in the MVP. JavaScript-only pages fall back to "paste the text". |
| Dates and calendar | `luxon`, `ics` | Always store UTC plus the original timezone. |
| Tests | `vitest` for `packages/core` (118 passing), `node --test` for web suites and migration contracts | Unit tests for schemas, ranking, reconcile, turns, guards and ics. The eval CLI is the integration test. |
| Deploy | Vercel, plus Supabase hosted | Keep the agent loop resumable (section 5) so a platform time limit never kills a run. |

## 4. Meta model integration map

Use each model only where it earns its place in the product. A forced integration reads as a gimmick to judges; a measured routing decision reads as engineering. **SHIPPED:** two transports in `packages/core/src/meta/`. Chat turns and the deep-scan loop stream the Responses API through `responsesCall`/`streamResponsesCall` (registry model, usage guarded, retry only on 429/5xx/network with backoff — any other 4xx, including the duplicate-item 400, fails fast carrying the full provider message). Page reading and judging go through `callModel({ role, input, schema?, tools? })`, which resolves the model from the registry, validates the output, retries once on a malformed response, backs off on HTTP 429, and records model, tokens, latency and estimated cost in a `usage` table.

**Facts from the official model list and pricing pages (checked Oct 27)**

- Base URL `https://api.meta.ai/v1`, bearer key in `MODEL_API_KEY`. Three request formats: Responses (`/v1/responses`), Chat Completions (OpenAI-compatible) and Messages (Anthropic-compatible). Documented as drop-in compatible with the OpenAI and Anthropic SDKs.
- `muse-spark-1.3` and `muse-wonder-1.0` accept text, image, video, audio and PDF and return text, with tool calling, structured output, search grounding and reasoning effort. Spark is $1.25 input and $4.25 output per 1M tokens; Wonder is $4.00 and $20.00 and is in preview.
- The `-contributor` Spark variants cost about a tenth as much but let Meta use your content for training, and are limited to 150 requests per minute.
- Search grounding costs $2.50 per 1,000 queries on top of tokens. SAM 3.1 costs $2.50 per 1,000 images. Muse Image costs $0.01 per image. Muse Voice Transcribe costs $0.18 per hour of audio.
- Spark Open and Muse Glimmer are open weights (Glimmer takes text and image and returns text); they run on a hosted provider or yourself, not through Model API. For the hackathon the Baseten model name is `meta-models/muse-spark-open-1026`.

**Role registry** (config in `registry.ts`, overridable by environment variables; change it by measurement, not by taste)

| Role | Default model | Used for | Reasoning effort | Alternative (A/B runs were cut) |
| --- | --- | --- | --- | --- |
| `orchestrator` | `muse-spark-1.3` | The conversation, tool calling loop, gate decisions | medium | `muse-wonder-1.0` for long, multi-step runs |
| `reader` | `muse-spark-1.3` | Reading each scanned page into the extraction schema, run in parallel | minimal or low | Spark Open or Glimmer on a hosted provider for cost; a contributor variant only for public page text and only behind a flag |
| `judge` | `muse-spark-1.3` | Reconciling conflicting pages, the internal fit assessment | high | `muse-wonder-1.0` |
| `writer` | `muse-spark-1.3` | Statements, cover letters, recommender and registrar emails, chat edits | medium | `muse-wonder-1.0`; pick by reading three samples side by side |
| `vision` | **CUT** — never called | Was: reading flyers and screenshots directly | n/a | none |
| `search` | Built-in search grounding on the orchestrator call | Finding the official page and its sub-pages | n/a | A separate search API only if grounding is unavailable |
| `voice` | **CUT** — no transcribe route shipped | Was: voice notes to text (milestone M9, optional) | n/a | none |

**Integration details**

- **Transport decisions (verified Oct 31, see `docs/META_API_NOTES.md` section 9):** stateless calls only — replay message history plus `function_call`/`function_call_output` pairs, never `reasoning` items, never `previous_response_id`. All turn input assembles through `buildInput(history, newItems)` with id dedupe. Retry only 429/5xx/network; any other 4xx fails fast with the full provider message.
- **Search:** use the built-in search grounding tool and keep its citations. Prefer results on the official institution domain and record the citation URLs as evidence. **SHIPPED** as the `web_search` conversation tool.
- **Structured output:** **SHIPPED** — the reader and judge parse JSON with zod plus one repair call carrying the validation error.
- **Tool calling:** **SHIPPED** — conversation tools `find_links`, `fetch_page`, `read_pdf`, `read_page`, `web_search`, `list_reminders`, `propose_plan`, `ask_profile_question`, `draft_document`, `request_approval`, `finish`; deep-scan loop capped at 12 turns, conversation at 3 rounds, 25 pages max, depth 2. Allow parallel tool calls.
- **Flyers:** **CUT** — no vision role calls, no upload endpoint, no SAM work. JavaScript-only pages fall back to "paste the text"; deadline text may be pasted too.
- **Voice (optional):** **CUT** — no transcribe route shipped. The `voice` role row above and the microcopy package remain for a future milestone.
- **Muse Image and Muse Wonder Full:** no core product need. Do not add them for the sake of using them. Muse Wonder 1.0 is only an A/B candidate for the roles above.
- **Muse Code:** the coding agent that builds the project. Say so in the README.

**Cost guard**

One deep scan of about 25 pages is roughly 75,000 input tokens and 10,000 output tokens, about $0.14 at Spark prices (about $0.50 on Wonder). Add search queries at $2.50 per 1,000. **SHIPPED:** per-session and global daily USD budgets from env plus abuse caps (message length, per-minute rate, per-IP daily runs on hashed IPs, page cap per run, upload size cap), all counted in Supabase. Only served pages are cached (in-turn page cache); the 24-hour `pages` cache table was **CUT**. Failure text distinguishes "daily limit reached" from "I need a minute": the run is still recorded and ends with its run id.

**Privacy rule for model modes**

Never use a contributor variant for any call that contains personal data (profile facts, drafts, pasted text). Only the `reader` role may use one, only on public page text, and only if you have read the contributor terms and decided it is acceptable.

**Day-one checks (VERIFY, then write the results with working request examples into `docs/META_API_NOTES.md`)**

1. A real `/v1/responses` call to `muse-spark-1.3` works from your location with your key, the billing page shows the $150 credit, and a spend-limit notification is set.
2. The built-in search tool syntax, that citations come back, and how search is billed.
3. The structured output parameter, and the function calling loop shape (call ids, parallel calls, streamed arguments).
4. Streaming event format for the Responses API, and how errors and 429s look.
5. Image input format on the endpoint you use. **CUT:** image input never used — no vision calls shipped.
6. Whether reasoning replay or server-managed state is available. If not, store the message history yourself in the `runs` table. **Done Oct 31:** neither is used — reasoning-free continuations return HTTP 200, history replays from the database.
7. SAM 3.1 and the speech endpoint request shapes, only if you plan to use them. **CUT:** neither shipped.

## 5. Agent architecture: tools, gates, resumable runs

The agent is a tool-calling loop on the `orchestrator` role. It runs on its own for everything read-only or reversible and halts only at a gate. Every run is stored so a gate can stay open for days and a platform timeout never kills work.

### 5.1 Tools (function tools, parallel calls allowed)

| Tool | Input | Does | Notes |
| --- | --- | --- | --- |
| `web_search` | built-in search grounding on the Responses call | Finds the official page and sub-pages | Keep citations. Prefer the official institution domain. Search also runs limited to the same domain: program name + FAQ, international applicants, funding, deadlines. |
| `fetch_page` | `url` | Plain `fetch`, cheerio + readability, returns clean text, title, outbound links | Respects robots.txt, 10s timeout, 1 req/s per host. Costs no model tokens. In-turn page cache only (the 24h cache table was cut). |
| `find_links` | `page_id` | Ranks the page's links with code (no model), returns the top N | Keywords: FAQ, apply, admissions, requirements, international, funding, fees, deadlines, prospective, eligibility, guidelines, the department name. Same official domain only (program, department, graduate school). |
| `read_pdf` | `url` | `unpdf` text extraction | Scanned PDFs with no text layer: report it as unreadable and give the link. |
| `read_page` | `page_id` | Runs the `reader` role over one page into the extraction schema | Run in parallel across pages. |
| `request_approval` | `{gate, what, evidence, options}` | Persists state and halts the run with `needs_approval` | The only way to stop for a human. |
| `finish` | `{result}` | Ends the run with the final structured result | Validated by zod. |

Hard caps: 12 orchestrator turns per run, 25 pages, link depth 2, 60 seconds per page fetch batch. The conversation loop runs at most 3 rounds per turn. If a cap is hit, finish with what was read and say so in friendly words. Conversation-only tools (same mechanism, chat turns): `web_search`, `list_reminders`, `propose_plan`, `ask_profile_question`, `draft_document`.

### 5.2 Gates

| Gate | When | Card the user sees |
| --- | --- | --- |
| G1 Program match | Always, before the deep scan | Program name from the school's page, department and school, with "Yes, that's it" and "Not quite". If no program with that exact name exists, say so and offer the closest matches. |
| G2 Uncertain or conflicting dates/rules | Only when a field is flagged `needs_human` | One plain question with the two sources and "Where I found this" links. Clear, evidenced dates never interrupt. They ride along inside G4. |
| G3 Profile facts used | Once per task | Asked as one chat question at a time via `ask_profile_question` (no standalone profile card). |
| G4 Calendar writes | Always | The reminder plan card and the Approve & Sync button. Guests link Google first (same user id, then return to the chat); the write is idempotent. Nothing is written anywhere before the click. |
| G5 Keeping a draft | Always, per draft | A draft review card for the returned payload. Draft versions and in-chat edits did not ship. |

Fit is advice and never a gate. After the honest read the agent asks exactly one question, "Want to go for it anyway?", records the answer in `decisions`, and never asks again. A "Not now" parks the chat and keeps the reminders that already exist.

### 5.3 Run state and resumption

- A `runs` row holds `status` (`running`, `needs_approval`, `done`, `failed`), `step`, `messages` (the full persisted history replayed statelessly; reasoning items are never replayed), `state` (typed working memory: confirmed program, pages, extraction, fit, plan, drafts), `pending_gate`, `turn_count`, `usage_usd`.
- `advance(runId)` in `packages/core/src/agent/` runs turns until it finishes, halts at a gate, or reaches 80% of `maxDuration`. After every tool result it persists to the database. On the time limit it emits a `continue` event and the client calls `/api/runs/[runId]/resume` with `{ continue: true }`, which re-enters `advance` from the stored state.
- `POST /api/runs/[runId]/resume` accepts `{ gate, decision, edits? }`, validates it against the stored `pending_gate`, writes the decision to `decisions`, and continues the loop with the decision appended as a tool result.
- Idempotency: every resume carries a client-generated `opId`. A repeated `opId` returns the stored result and does nothing twice.
- The same `advance` function is used by the web app and by the eval CLI.
- Chat turns run a separate 3-round loop (`runConversationTurn`): history replays from the database through `buildInput` (deduped by id, reasoning never replayed), tool failures return structured `{error}` results, and the loop ends on a model-written reply or a gate.

### 5.4 SSE event contract

`POST /api/chat` streams newline-delimited SSE events. Types are defined once in `packages/core/src/schemas/events.ts` and shared with the client.

```typescript
type RunEvent =
  | { t: "message"; id: string; text: string }                 // assistant bubble, may stream deltas
  | { t: "status"; id: string; label: string; state: "active" | "done" | "failed" }
  | { t: "card"; id: string; kind: "program" | "fit" | "requirements" | "plan" | "draft" | "pack" | "coverage" | "rolling_notice"; payload: unknown } // fit/pack kinds are in the contract; no fit card and no Pack screen shipped — prose carries the read
  | { t: "needs_approval"; gate: "G1" | "G2" | "G3" | "G4" | "G5"; card: unknown }
  | { t: "continue"; runId: string }
  | { t: "done"; runId: string }
  | { t: "error"; friendly: string; link?: string };

```

Status labels come only from `packages/core/src/voice/`. Examples: "Reading the admissions page", "Found the FAQ, checking it", "Reading the guidelines", "Putting your plan together".

## 6. Pipeline details

### 6.1 Understand

The first user message can be a sentence, a URL, or pasted text. The orchestrator extracts intent: opportunity type, institution, field, timing hint, language. **CUT:** image/flyer input — no upload endpoint and no vision role calls shipped, so screenshots cannot be sent; pasted text goes through the same reader. If the intent is too vague to search ("help me apply"), ask one short question.

### 6.2 Find and confirm (G1)

Use search grounding to find the official page, keep the citation URLs, prefer the official domain. Stop at G1 with one program card. Only after "Yes, that's it" does the deep scan start.

### 6.3 Deep scan

1. Discover: the confirmed page's links, `sitemap.xml` if present, and a few domain-limited searches.
2. Rank links with code, not the model. Stay on the official domain.
3. Fetch in parallel up to the budget, PDFs included, with robots.txt and rate limits respected.
4. Read each page once with the `reader` role into the extraction schema.
5. Reconcile with the `judge` role (6.5).
6. Emit a `coverage` card in friendly words: what was read, which page would not open (with its link), and whether anything was read in another language.

If a page needs JavaScript or a login, say which page and ask the user to paste its text. A pasted text goes through the same reader and is marked as user-provided in the evidence.

The scan hunts a fixed checklist, walked by the reader prompt:

| Category | Examples |
| --- | --- |
| Deadlines | Earlier dates for funding, international applicants or tracks; a separate portal opening date |
| Eligibility | Minimum grades, required prior degree, residency or citizenship limits |
| Documents | Word and page limits, extra forms, writing samples, portfolio |
| People | Contacting a faculty member first, number and type of recommenders |
| Tests | Required, optional or waived; score validity |
| Money | Application fee, fee waiver conditions, funding offered or not |

### 6.4 Extraction schema (zod, shared)

```typescript
const Confidence = z.enum(["high", "medium", "low"]);
const Evidenced = <T extends z.ZodTypeAny>(v: T) => z.object({
  value: v,
  evidence_quote: z.string().max(400),
  source_url: z.string(),          // "user-pasted" for pasted text (flyer uploads were cut)
  confidence: Confidence,
  needs_human: z.boolean().default(false),
  checked: z.boolean().default(false), // set by the evidence post-check
});

const DateField = Evidenced(z.object({
  iso_utc: z.string().nullable(),     // always UTC
  original_tz: z.string().nullable(), // IANA zone, or null if the page gave none
  all_day: z.boolean(),
  rolling: z.boolean().default(false),
}));

export const Extraction = z.object({
  program: z.object({ name: Evidenced(z.string()), unit: Evidenced(z.string()), institution: Evidenced(z.string()), portal_url: z.string().nullable(), language_read: z.string() }),
  opens: DateField.nullable(),         // null means not published
  deadlines: z.array(z.object({ label: z.string(), field: DateField })),
  documents: z.array(Evidenced(z.object({ name: z.string(), limit: z.string().nullable(), optional: z.boolean() }))),
  eligibility: z.array(Evidenced(z.object({ rule: z.string(), hard: z.boolean() }))),
  people: z.array(Evidenced(z.string())),
  tests: z.array(Evidenced(z.string())),
  money: z.array(Evidenced(z.string())),
  unusual_rules: z.array(Evidenced(z.string())), // anything that changes eligibility, a deadline, a document, a cost or who to contact
});

```

### 6.5 Evidence post-check and reconcile

- Post-check (code, no model): normalize whitespace and case, confirm the `evidence_quote` appears in the fetched page text and that the `value` is supported by it (dates parsed from the quote must equal the value). A mismatch sets `confidence` to `low` and `checked` to false.
- A date with no timezone: infer from an explicit zone or city on the page and mark `medium`; otherwise set `needs_human`.
- Reconcile rules: most specific page wins (program over department over graduate school), newest date wins, and any conflict is flagged `needs_human` and surfaces at G2 with both sources.
- If the opening date is not published, `opens` stays null. Say so plainly and create a check-again reminder (every 7 days). Never guess a date.
- Rolling deadlines: no deadline event. Create a reminder to apply early and a monthly check.

## 7. Fit, drafting, plan and the Application Pack

### 7.1 Profile (G3)

The profile is built only from facts this task needs, one short question at a time via `ask_profile_question` (current degree and field, institution, country, grades if the user wants to share them, research interests or relevant skills). The user can paste a CV or bio instead and Mizzou shows the extracted facts back. **SHIPPED as chat-only:** no profile screen, and the `profiles` table exists in migration 0001 but no code reads or writes it. **CUT:** the fictional sample profile and Forget me. Store nothing the task does not need. Grading scales and degree names are never assumed to be US ones; ask when unclear.

### 7.2 Fit (internal only)

The `judge` role reconciles conflicting pages and flags gaps against extraction fields (reconcile path **SHIPPED**). The honest read is delivered in chat prose in the pattern: what lines up, what looks like a stretch and why, what is missing. Then one question: "Want to go for it anyway?" **PARTIAL:** no internal fit score object and no standalone fit card — the read lives in prose, and the "Yes, let's apply" / "Not now" decision is recorded in `decisions` only where a gate carries it. It never helps misstate the user's credentials.

### 7.3 Reminder plan (G4)

**SHIPPED as:** one dated reminder per deadline plus one task row per required document (kind `custom`), all through idempotent `POST /api/reminders`. Missing opening date is stated plainly; no check-again timer ships. Store UTC plus the original timezone and show times in the user's local timezone.

- `.ics` via the `ics` package from `POST /api/calendar/ics` (public, no auth), with a deterministic UID from `sha256(title|iso|kind)`, so re-importing never duplicates.
- Calendar sync (M7) **PARTIAL:** guests link Google at Approve & Sync (incremental consent, same user id, return to the chat) and each deadline upserts a `sync_ledger` row keyed on `sha256(title|iso|kind)` — repeats are no-ops. No Google Calendar API write shipped; the `.ics` download is the calendar handoff.

### 7.4 Reminders that talk back

**CUT — reminders that talk back.** `GET` on the reminders data feeds the Coming up card and the left panel (title, status line, date pill), and tasks complete from the UI. Due-on-return chat prompts with Done/Snooze/Help chips did not ship.

### 7.5 Drafts (G5)

**PARTIAL:** `draft_document` returns a draft payload that renders as a review card ending at G5. Missing facts become `[PLACEHOLDER]`; never invent facts about the user or the program. **CUT:** in-chat draft edits and version history.

### 7.6 Application Pack

One screen, four parts. Mizzou writes and organizes. The user pastes, uploads, pays and clicks Submit.

| Part | Contents |
| --- | --- |
| Checklist | One row per requirement with status; tick rows off |
| Copy-ready answers | One card per likely portal question ("Why this program?") with the draft, a word count and a Copy button |
| Ready-to-send emails | A draft to each recommender (deadline and portal link) and one to the registrar for transcripts. Mizzou never sends them |
| Open portal | A button to the real application page |

Anything not confirmable from public pages is marked "check against the portal". **CUT:** the Application Pack screen did not ship — plan approval, the draft review card, and the `.ics` download are the handoffs.

## 8. UI: Liquid Glass, grayscale, responsive

> Precedence: colors, fonts and effects come from `docs/design/META_STYLE.md` and `docs/design/META_TOKENS.md`; layout, behavior, copy and gates still come from `PROMPT.md` and `docs/design/UI_CORRECTIONS.md`. (`META_TOKENS.md` is not in the repo yet — until it lands, `META_STYLE.md` and the provisional values in `styles/tokens.css` govern.)

Build the screens to match the reference screenshots in `docs/design/` (copy the nine PNG exports and the reference HTML files there; the HTML files hold the exact CSS values). Ship this single light look. No dark mode.

### 8.1 Tokens (`styles/tokens.css`)

| Token | Value |
| --- | --- |
| Typeface | Apple system font first (SF Pro on Apple devices), Inter as the fallback. The wordmark "Mizzou" is a formal script face, rendered from an SVG file in `public/` |
| Page background | `#FFFFFF` (solid white canvas; the gray-glass look was retired) |
| Wordmark | Formal script face in wordmark blue |
| Text | `#000000`. Secondary text `#65676B` |
| Cards | White surfaces, 20px radius, soft shadow, 1px hairline border |
| Hairline | `#DEE3E9` |
| Primary button | Meta blue `#0064E0`, white text, fully rounded. Deny and secondary actions are gray. |
| Secondary button | Gray fill, black text |
| Accent | None. Color only for function: small green check, red error |
| Motion | Framer Motion springs. Cards rise in, status lines swap with a short fade, no looping decoration. Respect `prefers-reduced-motion` |
| Layout | Responsive: under 768px a single column with the left panel as a drawer; 768px and up the panel floats over a centered column about 760px wide. "Where I found this" opens an evidence overlay (bottom sheet on mobile, right sheet on tablet, floating card on desktop), never a column or rail. `docs/design/UI_CORRECTIONS.md` is the layout source of truth. Safe-area padding throughout. 44px minimum touch targets |

Rules: no backdrop blur layers; every text pair at least 4.5:1 contrast.

### 8.2 Screens (as in the screenshots)

1. **Landing.** Wordmark, headline "From link to executed application.", a blue "Log in" pill top right (Google, returning users only), and a primary "Try it for free" button that opens `/app` on a silent anonymous session. **SHIPPED:** no signup page, no forced Google step.
2. **Sign-up.** **CUT:** the page was removed. First touch mints the anonymous session (proxy, plus the landing button); "Log in" links or signs in with Google only for returning users.
3. **Home.** Solid white top bar: round menu button left, wordmark center, round new-chat button right. The same top bar appears on every chat screen. Center: "Howdy, {first name}" and a line that rotates its bold keyword: "What **graduate programs** are you applying for today?" / "What **scholarships** are you applying for today?" / fellowships, jobs, internships, grants, conferences. Bottom: the Coming up card (title, "See all", rows with title, status line and a gray pill like "6 days" or "Soon"), then the composer.
4. **Composer.** Round plus button on the left, a wide pill input "Message Mizzou" with a blue focus border, a send arrow inside the pill's right end once there is text. The plus becomes an X and opens the PlusMenu chrome. **CUT:** photo/file upload inputs (uploads were cut).
5. **Left panel.** Overlay (opens on hover or tap, all widths). Wordmark and new-chat button; Reminders with a count badge and rows; Chats grouped Today / Previous 7 days / Older with "Clear all" and 5-second undo; bottom card with Settings and the user row — "Guest" plus "Save your chats, continue with Google" for guests, name and email when linked.
6. **Log out.** In Settings: "Delete my chats and reminders" (one tap, then replaced by a confirmation status and disabled). Anonymous rows also expire after 7 idle days. **CUT:** the logout confirm modal (sign-out returns to landing).
7. **Clear all chats.** One tap clears everything and shows a 5-second Undo toast. No extra dialog.
8. **Conversation.** Separate user/model bubbles, typing indicator, collapsible tool rows. The G1 card: program name, "{Department}, {School}", "Yes, that's it" and "Not quite". Plan cards carry Approve & Sync plus Download .ics; draft payloads render as review cards.
9. **Review.** "Got everything. Here's my honest read." The honest read lands in prose (no fit card): what lines up, what looks like a stretch and why, what is missing, ending in "Want to go for it anyway?" Then the "What they ask for" card: rows with a check (clear) or an exclamation (needs a look), a short plain note, and an underlined "Where I found this" link that opens the evidence quote and the source page. An unpublished opening date is stated plainly.
10. **Plan and draft.** "Here's the plan. Nothing goes on your calendar until you say so." A plan card (dated reminders plus document tasks), a draft review card, then "Approve & Sync" and "Not yet". **CUT:** the fixed three-reminder timeline and the in-draft edit box.

The UI never shows scores, percentages, probabilities, model names, token counts, schemas or the words "AI agent".

### 8.3 Voice microcopy

Every user-facing string the agent emits lives in `packages/core/src/voice/` as named constants, so tone stays consistent. Short sentences, first person, warm, no jargon, no emoji, no preaching. Required lines include: "On it. Let me find the right page and see what they ask for." / "Quick check before I go further. Is this the program you mean?" / "Got everything. Here's my honest read." / "That page wouldn't open for me. Can you paste the text?" / "I need a minute." (budget hit) / "I read this page in {language}." Error messages follow the same voice and always include a next step or a link.

## 9. Data, API contracts, budgets, privacy

### 9.1 Supabase tables (migrations in `supabase/migrations/`)

`profiles` (migration only, unused by code), `chats`, `messages`, `runs`, `pages` (migration only, never read — cut), `extractions`, `opportunities`, `decisions` (gate, decision, opId), `drafts`, `reminders`, `tasks`, `sync_ledger` (unique on user + event, idempotent), `usage` (model, tokens, latency, estimated cost, user id, run id), `uploads` (migration only, no upload endpoint), `rate_counters` (abuse caps, hashed IPs only).

- Row level security on every user table: `user_id = auth.uid()`. `rate_counters` has RLS enabled with no policies — only the service role reads and writes. No raw IPs are ever stored.
- Guests are anonymous Supabase users (no sample profile, no Forget me), so isolation works the same way. Idle anonymous users are deleted after 7 days with all their rows (migration 0004, `docs/RETENTION.md`).
- Clear all chats soft-deletes for 5 seconds (undo window), then hard-deletes chats, messages, runs, drafts and uploads.
- Store UTC plus the original timezone for every date.

### 9.2 Routes

Exactly the route handlers listed in section 3. `api/chat` streams SSE with `maxDuration` at the platform maximum. All inputs and outputs are zod-validated. **CUT:** uploads — no upload endpoint shipped, only the size-cap helper and env var for it.

### 9.3 Budgets and caching

- Env: `PER_USER_DAILY_USD` (default 1.00), `GLOBAL_DAILY_USD` (default 15) — dev pins 5 / 25 — plus `MAX_MESSAGE_CHARS` (4000), `MAX_RUNS_PER_IP_PER_DAY` (50), `MAX_HITS_PER_IP_PER_MINUTE` (20), `MAX_PAGES_PER_RUN` (25), `MAX_UPLOAD_BYTES` (8 MiB), optional `IP_HASH_SALT` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. `GUEST_RUNS_PER_DAY` was replaced by the per-IP daily run cap.
- Every model call records cost to `usage` and checks the USD budgets before the call; per-minute and per-IP caps are counted in `rate_counters`. Daily exhaustion says when to return ("daily limit reached" / "tomorrow"); transient pressure says "I need a minute". The run is still recorded and ends with its run id — never a stack trace.
- **CUT:** the 24-hour page/extraction cache and search-result cache; in-turn caching only. **CUT:** recorded sample runs as a live fallback.

### 9.4 Privacy

Store only what the task needs. Never send personal data (profile facts, drafts, pasted text) to a contributor variant. No signup required: anonymous sessions, optional Google link. Delete idle anonymous users after 7 days; Clear all chats for everyone with 5-second undo. Demo data is fictional (and the day-count guard keeps it out of app code).

## 10. Evaluation harness (`packages/eval`)

- `cases/*.json`: **PARTIAL** — one hand-labeled case (`case-01`) shipped as the committed baseline (1/1 deadlines, recall 33.3%, precision 100%, evidence 14/15, $0.0377 in `docs/EVAL_REPORT.md`). The 10-case mix (clean pages, JS-heavy pages, PDFs, flyers, two non-academic items) was not built out.

```json
{ "id": "case-01", "kind": "program", "input": { "type": "url", "value": "https://..." },
  "expected": { "opens": "2026-09-01T00:00:00Z|null", "deadlines": [{ "label": "...", "iso_utc": "..." }],
                "documents": ["..."], "unusual_rules": ["..."] }, "notes": "" }

```

- `pnpm eval` runs the same `advance` code the app uses, in autonomous mode with gates auto-approved, over all cases. It runs two configurations: **baseline** (single page, no link following) and **deep scan**.
- Metrics, printed and written to `docs/EVAL_REPORT.md` and `docs/eval-results.json`: date exact-match accuracy after timezone normalization (reported as "N of M deadlines correct"), requirement recall and precision with fuzzy matching, evidence validity rate (post-check pass rate), correct `needs_human` flags, buried-rule recovery (found only by deep scan), cost and latency per case.
- **CUT:** the role A/B comparisons on the eval set — defaults were chosen by reasoning and recorded, not measured.
- Report only measured numbers in the README and the video. Unit tests (118 in `packages/core` plus the web suites) cover schemas, link ranking, reconcile, timezone handling, the evidence check, turn assembly, retry policy, caps, and `.ics` UID stability.

## 11. Milestones

After each milestone: run it, commit with a small clear message, update `STATUS.md` (done, next, blockers). First commit on or after Oct 27.

| # | Target | Build | Done when |
| --- | --- | --- | --- |
| M0 | Oct 27 | **SHIPPED** — monorepo scaffold, pnpm workspace, tsconfig, `.env.example`, STATUS.md, Supabase and Vercel wiring, day-one checks in `docs/META_API_NOTES.md` | A real `/v1/responses` call to `muse-spark-1.3` returns, and the notes file exists |
| M1 | Oct 27 | **SHIPPED** — `callModel` wrapper, role registry, usage logging, 429 backoff, structured output with one repair retry, extraction schema with evidence post-check | One URL in, valid evidenced JSON out, post-check passing |
| M2 | Oct 28 | **PARTIAL** — Eval CLI, 1 labeled case, baseline run | `pnpm eval` prints a baseline report; the 10-case set was cut |
| M3 | Oct 28 | **SHIPPED — thin vertical slice.** Chat UI shell, anonymous guest session, URL in, status lines streaming, G1 card, requirements card, plan card, `.ics` download | A full demo path works end to end, even if plain |
| M4 | Oct 29 | **SHIPPED** — search grounding, link ranking, parallel fetch, PDF reading, deep scan with budget, resumable runs, reconcile, G2, coverage card | Deep scan path works with gates; single-case baseline committed |
| M5 | Oct 30 | **PARTIAL** — profile by conversation and G3 shipped; fit read lives in chat prose, no fit card or score object | "Want to go for it anyway?" asked in plain words; flyer upload and vision calls cut |
| M6 | Oct 31 | **PARTIAL** — `draft_document` returns a review card ending at G5 | A statement payload is drafted and kept; chat edits, versions, and the Pack screen cut |
| M7 | Nov 1 | **PARTIAL** — no signup, optional Google link, incremental consent at Approve & Sync, idempotent reminders + sync-ledger writes, public `.ics`, Coming up card | Repeat approvals never duplicate; talk-back prompts and a real Calendar API write cut |
| M8 | Nov 1 | **SHIPPED (white canvas, not glass)** — solid white top bar, overlay panel, Muse-style settings dialog, Guest row, Clear all with Undo, USD budgets plus Supabase abuse caps, retry policy, 7-day anonymous retention | UI matches section 8 as updated; budgets and caps enforce; recorded runs cut |
| M9 | Nov 2 | **CUT** — voice notes and SAM 3.1 did not ship and are not claimed | Microcopy package and role rows remain for a future milestone |
| M10 | Nov 3 | **PARTIAL** — README complete, single-case eval report committed, this brief finished as the as-built record | **CUT:** role A/B runs, ARCHITECTURE.md, DEMO_SCRIPT.md, architecture image, demo video shots |

Nov 4 is buffer only. Submit by midday Lagos time (the deadline is Nov 4, 9:00 PM ET), then reopen the submission to confirm it saved.

## 12. Docs, README and submission

### 12.1 README (for judges)

Sections, in order (as shipped): The problem; What Mizzou does; Human in the loop; **Meta models and tools used and where** (every one actually used, with the role and file path — `muse-spark-1.3` as orchestrator, reader, judge and writer; search grounding; Muse Code as the coding agent that built the project; vision, voice and SAM listed as cut); evaluation results (measured numbers only, single-case baseline); architecture (the agent loop, gates, resumable runs, evidence post-check); run instructions ("Run it"); Known limits; Status; Built during the hackathon; licenses of the open-source libraries used; roadmap named as next steps and not as features. The one-line pitch drops the flyer: "Mizzou is an autonomous agent that turns a link or a sentence into a ready-to-act application plan, with a human approving every step that matters."

### 12.2 Docs

`docs/META_API_NOTES.md` (verified shapes and examples, including the Oct 31 reasoning-replay probe), `docs/RETENTION.md` (anonymous retention), `docs/EVAL_REPORT.md` (single-case baseline). **CUT:** `docs/ARCHITECTURE.md`, the architecture image, and `docs/DEMO_SCRIPT.md`.

### 12.3 Demo storyboard (3:00, ends on the synced reminders and the .ics download)

| Time | Shot | Line |
| --- | --- | --- |
| 0:00 to 0:25 | The builder, then a messy folder of links | "I kept missing deadlines and drowning in requirements. So I built Mizzou." |
| 0:25 to 0:50 | Try it for free — no signup — say what you need in a sentence | "No account, just tell it what you need." |
| 0:50 to 1:25 | Status lines run; G1 confirm | "The agent follows the links a human would, using Muse Spark to decide where to look." |
| 1:25 to 1:50 | Review cards; hover "Where I found this" to show the quote; one flagged ambiguity | "Every date points back to its source. When it is unsure, it asks me." |
| 1:50 to 2:10 | Honest fit read in plain words, "go for it anyway", draft review card | "It tells me honestly where I stand before I spend my time." |
| 2:10 to 2:35 | Approve & Sync, sync-ledger write, downloaded .ics | "Nothing is written until I approve." |
| 2:35 to 3:00 | Measured accuracy, a real tester quote, what is next | Use only measured numbers. |

### 12.4 Submission checklist

- Public GitHub repository with the first commit on or after Oct 27 and a clean, small-commit history
- README complete with the sections above, including "Built during the hackathon" and the Meta models and tools list
- Live URL that works with no login (anonymous guest path) — **SHIPPED**
- Demo video under 3 minutes — **CUT, not produced**
- Short description naming every Meta model and tool actually used
- Architecture image — **CUT, not produced**
- Team field: solo
- No secrets in the repo; `.env.example` committed
- Submitted before midday Lagos time on Nov 4, then reopened to verify

### 12.5 Definition of done

Every feature in the demo is real and visible. Gates fire where section 5 says and nowhere else. Every date and requirement has a "Where I found this" link backed by a checked quote. Nothing is ever sent, submitted or logged into on the user's behalf. Budgets and abuse caps hold; the single-case eval report is committed with measured numbers. STATUS.md is current and every milestone is committed. Anything marked **CUT** above is absent and unclaimed — no flyer uploads, no Pack screen, no talk-back, no recorded runs, no A/B comparisons, no architecture image or demo video.
