# Mizzou: full build prompt

Oct 27, 2026 · @Olamide Fasogbon

This is the single brief to hand to your coding agent (Muse Code or any other). Export it as Markdown and save it in the repo root as PROMPT.md.

## 1. How to use this prompt

You are the lead engineer building Mizzou, a solo hackathon project, in a monorepo. Read this whole document before writing code. Everything here is a requirement unless it is marked optional.

**Working rules**

- Work in the milestones in section 11. After each milestone: run it, commit, and update `STATUS.md` with what is done, what is next, and any blocker.
- Do not ask the human questions unless you are blocked on a secret key or a product decision this document does not cover. Otherwise decide, write the decision in `STATUS.md`, and continue.
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
5. Build the profile through conversation only for facts this task needs (gate G3), then give an honest fit read and ask "want to go for it anyway?".
6. Propose the reminder plan and drafts (gates G4 and G5).
7. Prepare the Application Pack: checklist, copy-ready answers, recommender and registrar email drafts, link to the real portal.
8. Keep following up: reminders that talk back when the user returns.

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
10. **Privacy.** Store only what the task needs, isolate every user's data, offer Clear all chats with a 5-second undo, and never use a training-data (contributor) model mode with personal data.

## 3. Monorepo structure and stack

Use **one repository, one language (TypeScript), one deploy.** A second backend language would double the setup, the typing and the debugging for a solo builder. The agent lives in a framework-free package so the web app and the evaluation script run exactly the same code.

```text
mizzou/
  PROMPT.md  STATUS.md  README.md  .env.example
  package.json  pnpm-workspace.yaml  tsconfig.base.json
  apps/
    web/                         Next.js 15 (App Router), Tailwind, Framer Motion
      app/
        page.tsx                 Landing
        signup/page.tsx          Sign-up (Google)
        app/layout.tsx           App shell: top bar, side panel, composer
        app/page.tsx             Home: greeting, Coming up card
        app/c/[chatId]/page.tsx  Conversation
        auth/callback/route.ts   Auth callback
        api/chat/route.ts        POST: starts or continues a run, streams events (SSE)
        api/runs/[runId]/resume/route.ts   POST: continue after a gate decision
        api/reminders/route.ts   GET: Coming up and panel reminders
        api/chats/route.ts       GET list, DELETE clear all, POST undo clear
        api/upload/route.ts      POST: flyer image or PDF
        api/calendar/ics/route.ts   GET: .ics for approved plan
        api/calendar/sync/route.ts  POST: Google Calendar write (milestone M7)
        api/transcribe/route.ts  POST: voice note to text (optional, M9)
      components/                shell/ home/ chat/ cards/ ui/
      lib/                       supabase clients, sse client, tokens
      styles/tokens.css          design tokens from section 8
  packages/
    core/                        no framework imports
      src/meta/                  client, model registry, structured output, speech, images
      src/agent/                 orchestrator, tools/, gates, run state, events
      src/scan/                  discover, rank links, fetch, pdf, readability, budget, cache
      src/extract/               page reader, reconcile, evidence check
      src/fit/                   internal fit assessment
      src/draft/                 drafting, application pack
      src/plan/                  reminder plan, ics
      src/prompts/               every system prompt as a versioned file
      src/schemas/               zod schemas shared with the web app
      src/voice/                 microcopy: every user-facing string the agent emits
    eval/                        CLI: labeled cases, baseline vs deep scan, report
      cases/                     one JSON file per labeled opportunity
  supabase/migrations/           SQL migrations and RLS policies
  docs/                          META_API_NOTES.md ARCHITECTURE.md DEMO_SCRIPT.md
```

| Layer | Choice | Notes |
| --- | --- | --- |
| Web | Next.js 15, React, TypeScript, Tailwind CSS, Framer Motion | Mobile first. Respect reduced motion. |
| Server | Next.js route handlers, Node runtime | SSE for live progress. Set `maxDuration` to the platform maximum. |
| Agent core | `packages/core`, plain TypeScript | The only place that talks to Meta models. |
| Models | Meta Model API through the `openai` npm package with `baseURL` set to `https://api.meta.ai/v1` | Documented as drop-in compatible with the OpenAI SDK. If a needed feature is not exposed by the SDK, call the REST endpoint with `fetch`. |
| Database and auth | Supabase: Postgres, Google sign-in, row level security | Basic Google scopes only at sign-in. |
| Validation | `zod` | Every model output is parsed. One repair retry, then a graceful fallback. |
| Page reading | `cheerio` plus `@mozilla/readability`; `unpdf` for PDFs | No headless browser in the MVP. JavaScript-only pages fall back to "paste the text". |
| Dates and calendar | `luxon`, `ics` | Always store UTC plus the original timezone. |
| Tests | `vitest` | Unit tests for schemas, ranking, reconcile and ics. The eval CLI is the integration test. |
| Deploy | Vercel, plus Supabase hosted | Keep the agent loop resumable (section 5) so a platform time limit never kills a run. |

## 4. Meta model integration map

Use each model only where it earns its place in the product. A forced integration reads as a gimmick to judges; a measured routing decision reads as engineering. Every model call goes through one wrapper, `callModel({ role, input, schema?, tools? })`, in `packages/core/src/meta/`, which resolves the model from a registry, validates the output, retries once on a malformed response, backs off on HTTP 429, and records model, tokens, latency and estimated cost in a `usage` table.

**Facts from the official model list and pricing pages (checked Oct 27)**

- Base URL `https://api.meta.ai/v1`, bearer key in `MODEL_API_KEY`. Three request formats: Responses (`/v1/responses`), Chat Completions (OpenAI-compatible) and Messages (Anthropic-compatible). Documented as drop-in compatible with the OpenAI and Anthropic SDKs.
- `muse-spark-1.3` and `muse-wonder-1.0` accept text, image, video, audio and PDF and return text, with tool calling, structured output, search grounding and reasoning effort. Spark is $1.25 input and $4.25 output per 1M tokens; Wonder is $4.00 and $20.00 and is in preview.
- The `-contributor` Spark variants cost about a tenth as much but let Meta use your content for training, and are limited to 150 requests per minute.
- Search grounding costs $2.50 per 1,000 queries on top of tokens. SAM 3.1 costs $2.50 per 1,000 images. Muse Image costs $0.01 per image. Muse Voice Transcribe costs $0.18 per hour of audio.
- Spark Open and Muse Glimmer are open weights (Glimmer takes text and image and returns text); they run on a hosted provider or yourself, not through Model API. For the hackathon the Baseten model name is `meta-models/muse-spark-open-1026`.

**Role registry** (config in `registry.ts`, overridable by environment variables; change it by measurement, not by taste)

| Role | Default model | Used for | Reasoning effort | Alternative to A/B on the eval set |
| --- | --- | --- | --- | --- |
| `orchestrator` | `muse-spark-1.3` | The conversation, tool calling loop, gate decisions | medium | `muse-wonder-1.0` for long, multi-step runs |
| `reader` | `muse-spark-1.3` | Reading each scanned page into the extraction schema, run in parallel | minimal or low | Spark Open or Glimmer on a hosted provider for cost; a contributor variant only for public page text and only behind a flag |
| `judge` | `muse-spark-1.3` | Reconciling conflicting pages, the internal fit assessment | high | `muse-wonder-1.0` |
| `writer` | `muse-spark-1.3` | Statements, cover letters, recommender and registrar emails, chat edits | medium | `muse-wonder-1.0`; pick by reading three samples side by side |
| `vision` | `muse-spark-1.3` with an image input | Reading flyers and screenshots directly | low | none |
| `search` | Built-in search grounding on the orchestrator call | Finding the official page and its sub-pages | n/a | A separate search API only if grounding is unavailable |
| `voice` | `muse-voice-transcribe-1.0` | Voice notes to text (milestone M9, optional) | n/a | none |

**Integration details**

- **Search:** use the built-in search grounding tool and keep its citations. The launch post shows it as a tool entry of type `web_search` on the Responses API (**VERIFY** the exact shape). Prefer results on the official institution domain and record the citation URLs as evidence.
- **Structured output:** request JSON that matches the zod schema using the documented structured output feature (**VERIFY** the parameter). If it is missing or flaky, ask for JSON in the prompt, parse with zod, and run one repair call that includes the validation error.
- **Tool calling:** define `fetch_page`, `read_pdf`, `find_links`, `request_approval` and `finish` as function tools (section 5). Allow parallel tool calls. Cap the loop at 12 model turns per run.
- **Flyers:** send the image straight to the vision role and ask for the same extraction schema, with the evidence quote copied from the image text. Compress images to 1600px on the long side before sending.
- **Voice (optional):** the browser records a short note, converts it to 16 kHz mono 16-bit WAV in the browser, and posts it to the server, which calls `POST /v1/asr/transcribe` with model `muse-voice-transcribe-1.0`. Limits: 32 MB body and 10 minutes of audio, so cap notes at 60 seconds. It supports 25 languages with code-switching, which suits a global audience. Show the transcript in the composer for the user to edit before sending.
- **SAM 3.1 (optional, time-box 90 minutes):** after a flyer is read, ask SAM 3.1 for the region containing the date text and draw it on the flyer as the "Where I found this" evidence. Keep it only if it works on at least three of five sample flyers. Otherwise cut it and do not claim it.
- **Muse Image and Muse Wonder Full:** no core product need. Do not add them for the sake of using them. Muse Wonder 1.0 is only an A/B candidate for the roles above.
- **Muse Code:** the coding agent that builds the project. Say so in the README.

**Cost guard**

One deep scan of about 25 pages is roughly 75,000 input tokens and 10,000 output tokens, about $0.14 at Spark prices (about $0.50 on Wonder). Add search queries at $2.50 per 1,000. Enforce a per-user daily budget and a global daily budget in code, cache every fetched page and every extraction by URL hash for 24 hours, and show a friendly "I need a minute" message when a budget is hit.

**Privacy rule for model modes**

Never use a contributor variant for any call that contains personal data (profile facts, drafts, uploads, voice). Only the `reader` role may use one, only on public page text, and only if you have read the contributor terms and decided it is acceptable.

**Day-one checks (VERIFY, then write the results with working request examples into `docs/META_API_NOTES.md`)**

1. A real `/v1/responses` call to `muse-spark-1.3` works from your location with your key, the billing page shows the $150 credit, and a spend-limit notification is set.
2. The built-in search tool syntax, that citations come back, and how search is billed.
3. The structured output parameter, and the function calling loop shape (call ids, parallel calls, streamed arguments).
4. Streaming event format for the Responses API, and how errors and 429s look.
5. Image input format on the endpoint you use.
6. Whether reasoning replay or server-managed state is available. If not, store the message history yourself in the `runs` table.
7. SAM 3.1 and the speech endpoint request shapes, only if you plan to use them.

## 5. Agent architecture: tools, gates, resumable runs

The agent is a tool-calling loop on the `orchestrator` role. It runs on its own for everything read-only or reversible and halts only at a gate. Every run is stored so a gate can stay open for days and a platform timeout never kills work.

### 5.1 Tools (function tools, parallel calls allowed)

| Tool | Input | Does | Notes |
| --- | --- | --- | --- |
| `web_search` | built-in search grounding on the Responses call | Finds the official page and sub-pages | Keep citations. Prefer the official institution domain. Search also runs limited to the same domain: program name + FAQ, international applicants, funding, deadlines. |
| `fetch_page` | `url` | Plain `fetch`, cheerio + readability, returns clean text, title, outbound links | Respects robots.txt, 10s timeout, 1 req/s per host. Costs no model tokens. Cached by URL hash for 24h. |
| `find_links` | `page_id` | Ranks the page's links with code (no model), returns the top N | Keywords: FAQ, apply, admissions, requirements, international, funding, fees, deadlines, prospective, eligibility, guidelines, the department name. Same official domain only (program, department, graduate school). |
| `read_pdf` | `url` | `unpdf` text extraction | Scanned PDFs with no text layer: report it as unreadable and give the link. |
| `read_page` | `page_id` | Runs the `reader` role over one page into the extraction schema | Run in parallel across pages. |
| `request_approval` | `{gate, what, evidence, options}` | Persists state and halts the run with `needs_approval` | The only way to stop for a human. |
| `finish` | `{result}` | Ends the run with the final structured result | Validated by zod. |

Hard caps: 12 orchestrator turns per run, 25 pages, link depth 2, 60 seconds per page fetch batch. If a cap is hit, finish with what was read and say so in friendly words.

### 5.2 Gates

| Gate | When | Card the user sees |
| --- | --- | --- |
| G1 Program match | Always, before the deep scan | Program name from the school's page, department and school, with "Yes, that's it" and "Not quite". If no program with that exact name exists, say so and offer the closest matches. |
| G2 Uncertain or conflicting dates/rules | Only when a field is flagged `needs_human` | One plain question with the two sources and "Where I found this" links. Clear, evidenced dates never interrupt. They ride along inside G4. |
| G3 Profile facts used | Once per task | Shows the few facts about the user that this task uses, as editable lines, with "Looks right". |
| G4 Calendar writes | Always | The reminder plan card and the Approve & Sync button. Nothing is written anywhere before the click. |
| G5 Keeping a draft | Always, per draft | The draft card with the edit box and a keep button. |

Fit is advice and never a gate. After the honest read the agent asks exactly one question, "Want to go for it anyway?", records the answer in `decisions`, and never asks again. A "Not now" parks the chat and keeps the reminders that already exist.

### 5.3 Run state and resumption

- A `runs` row holds `status` (`running`, `needs_approval`, `done`, `failed`), `step`, `messages` (the full model message history, since reasoning replay may not exist), `state` (typed working memory: confirmed program, pages, extraction, fit, plan, drafts), `pending_gate`, `turn_count`, `usage_usd`.
- `advance(runId)` in `packages/core/src/agent/` runs turns until it finishes, halts at a gate, or reaches 80% of `maxDuration`. After every tool result it persists to the database. On the time limit it emits a `continue` event and the client calls `/api/runs/[runId]/resume` with `{ continue: true }`, which re-enters `advance` from the stored state.
- `POST /api/runs/[runId]/resume` accepts `{ gate, decision, edits? }`, validates it against the stored `pending_gate`, writes the decision to `decisions`, and continues the loop with the decision appended as a tool result.
- Idempotency: every resume carries a client-generated `opId`. A repeated `opId` returns the stored result and does nothing twice.
- The same `advance` function is used by the web app and by the eval CLI.

### 5.4 SSE event contract

`POST /api/chat` streams newline-delimited SSE events. Types are defined once in `packages/core/src/schemas/events.ts` and shared with the client.

```typescript
type RunEvent =
  | { t: "message"; id: string; text: string }                 // assistant bubble, may stream deltas
  | { t: "status"; id: string; label: string; state: "active" | "done" | "failed" }
  | { t: "card"; id: string; kind: "program" | "fit" | "requirements" | "plan" | "draft" | "pack" | "coverage"; payload: unknown }
  | { t: "needs_approval"; gate: "G1" | "G2" | "G3" | "G4" | "G5"; card: unknown }
  | { t: "continue"; runId: string }
  | { t: "done"; runId: string }
  | { t: "error"; friendly: string; link?: string };

```

Status labels come only from `packages/core/src/voice/`. Examples: "Reading the admissions page", "Found the FAQ, checking it", "Reading the guidelines", "Putting your plan together".

## 6. Pipeline details

### 6.1 Understand

The first user message can be a sentence, a URL, pasted text or an image. The orchestrator extracts intent: opportunity type, institution, field, timing hint, language. A flyer or screenshot goes to the `vision` role with the same extraction schema. Compress images to 1600px on the long side first. If the intent is too vague to search ("help me apply"), ask one short question.

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
  source_url: z.string(),          // upload id for flyers, "user-pasted" for pasted text
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

- Post-check (code, no model): normalize whitespace and case, confirm the `evidence_quote` appears in the fetched page text (or the vision transcription) and that the `value` is supported by it (dates parsed from the quote must equal the value). A mismatch sets `confidence` to `low` and `checked` to false.
- A date with no timezone: infer from an explicit zone or city on the page and mark `medium`; otherwise set `needs_human`.
- Reconcile rules: most specific page wins (program over department over graduate school), newest date wins, and any conflict is flagged `needs_human` and surfaces at G2 with both sources.
- If the opening date is not published, `opens` stays null. Say so plainly and create a check-again reminder (every 7 days). Never guess a date.
- Rolling deadlines: no deadline event. Create a reminder to apply early and a monthly check.

## 7. Fit, drafting, plan and the Application Pack

### 7.1 Profile (G3)

The profile is built only from facts this task needs, one short question at a time (current degree and field, institution, country, grades if the user wants to share them, research interests or relevant skills). The user can paste a CV or bio instead and Mizzou shows the extracted facts back. Signed-in users store the profile in `profiles` under row level security. Guests get a pre-filled fictional sample profile and a visible Forget me. Store nothing the task does not need. Grading scales and degree names are never assumed to be US ones; ask when unclear.

### 7.2 Fit (internal only)

The `judge` role returns an internal object: matched criteria, hard-rule gaps, competitive gaps, the single biggest risk, each gap citing the extraction field it came from. The score and any numbers never leave the server. The UI card says it in plain words, in the pattern: what lines up, what looks like a stretch and why, what is missing. Then one question: "Want to go for it anyway?" with "Yes, let's apply" and "Not now". It may add practical advice (how to address a gap in the statement, whom to ask about a waiver, the fee at stake). It never helps misstate the user's credentials.

### 7.3 Reminder plan (G4)

Three reminders per opportunity: two weeks before the deadline (get documents ready), the day it opens (portal link), three days before the deadline (final push). Plus one task per required document. Missing opening date replaces the middle reminder with a check-again reminder. Store UTC plus the original timezone and show times in the user's local timezone.

- `.ics` via the `ics` package from `/api/calendar/ics`, with a deterministic `UID = sha256(userId|opportunityId|kind)`, so re-importing never duplicates.
- Google Calendar sync (M7): request the Calendar events scope only at Approve & Sync (incremental consent). Write each event with a deterministic event id (lowercase base32hex derived from the same hash). A 409 on insert is treated as success and the existing event is patched. Keep a `sync_ledger` row per event. If the user declines the permission, or Google blocks it for an unverified app, offer the `.ics` download and Add to Google Calendar links instead.

### 7.4 Reminders that talk back

`/api/reminders` feeds the Coming up card and the left panel. Each item has a title, a short status line ("Statement of purpose, not finished", "Portal opens soon, I'm watching it", "2 documents left") and a pill ("6 days", "Soon"). When the user returns and a reminder is due, the chat opens with: "Your statement of purpose is due in 6 days. Done, snooze, or want help?" with chips for Done, Snooze and Help me. Calendar handles alerts. The chat handles follow-through.

### 7.5 Drafts (G5)

The `writer` role drafts the statement from the confirmed profile facts and the program's own wording. Missing facts become `[PLACEHOLDER]`. Chat edits ("make it more academic") rewrite the draft in place and keep versions. Each draft ends at G5. Never invent facts about the user or the program.

### 7.6 Application Pack

One screen, four parts. Mizzou writes and organizes. The user pastes, uploads, pays and clicks Submit.

| Part | Contents |
| --- | --- |
| Checklist | One row per requirement with status; tick rows off |
| Copy-ready answers | One card per likely portal question ("Why this program?") with the draft, a word count and a Copy button |
| Ready-to-send emails | A draft to each recommender (deadline and portal link) and one to the registrar for transcripts. Mizzou never sends them |
| Open portal | A button to the real application page |

Anything not confirmable from public pages is marked "check against the portal". Stretch only if everything else is done: guided fill that shows each value and waits for approval, with Submit always left to the user.

## 8. UI: Liquid Glass, grayscale, responsive

> Precedence: colors, fonts and effects come from `docs/design/META_STYLE.md` and `docs/design/META_TOKENS.md`; layout, behavior, copy and gates still come from `PROMPT.md` and `docs/design/UI_CORRECTIONS.md`. (`META_TOKENS.md` is not in the repo yet — until it lands, `META_STYLE.md` and the provisional values in `styles/tokens.css` govern.)

Build the screens to match the reference screenshots in `docs/design/` (copy the nine PNG exports and the reference HTML files there; the HTML files hold the exact CSS values). Ship this single light look. No dark mode.

### 8.1 Tokens (`styles/tokens.css`)

| Token | Value |
| --- | --- |
| Typeface | Apple system font first (SF Pro on Apple devices), Inter as the fallback. The wordmark "Mizzou" is a formal script face, rendered from an SVG file in `public/` |
| Page background | `#E9E9EB` |
| Blurred shapes behind content | `#``CFCFD4, #C4C4CA and one lighter #F7F7F9`, heavily blurred, no color gradients |
| Text | `#000000`. `Secondary text #48484A (passes 4.5:1 on the gray page)` |
| Glass surface | `rgba(255,255,255,0.42)`, `backdrop-filter: blur(24px) saturate(180%)`, 1px border `rgba(255,255,255,0.7)`, soft shadow, 28px card radius, capsule controls, a bright inner top highlight rgba(255,255,255,0.85) |
| Hairline | `rgba(0,0,0,0.10)` |
| Primary button | Solid black, white text, fully rounded. Black is only for the main action on a screen (at most one per screen). Deny and secondary actions are gray. |
| Secondary button | Gray fill, black text |
| Accent | None. Color only for function: small green check, red error |
| Motion | Framer Motion springs. Cards rise in, status lines swap with a short fade, no looping decoration. Respect `prefers-reduced-motion` |
| Layout | Responsive: under 768px a single column with the left panel as a drawer; 768px and up the panel floats over a centered column about 760px wide. "Where I found this" opens an evidence overlay (bottom sheet on mobile, right sheet on tablet, floating card on desktop), never a column or rail. `docs/design/UI_CORRECTIONS.md` is the layout source of truth. Safe-area padding throughout. 44px minimum touch targets |

Rules: backdrop blur on at most three layers at once; every text-on-glass pair at least 4.5:1 contrast.

### 8.2 Screens (as in the screenshots)

1. **Landing.** Wordmark, headline "From link to executed application.", a glass pill "You approve every step", a full-width black button "Try it for free", and "Already have an account? **Log in**" below.
2. **Sign-up.** Back circle button top left. A glass card with the wordmark, "Let's get you started.", "One tap with Google and we can start on your first application.", black button "Continue with Google", gray button "Look around as a guest". Footer: "By continuing you agree to the terms and the privacy policy."
3. **Home.** Top bar: round menu button left, wordmark center, round new-chat button right. The same top bar appears on every chat screen. Center: "Howdy, {first name}" and a line that rotates its bold keyword: "What **graduate programs** are you applying for today?" / "What **scholarships** are you applying for today?" / fellowships, jobs, internships, grants, conferences. Bottom: the Coming up card (title, "See all", rows with title, status line and a gray pill like "6 days" or "Soon"), then the composer.
4. **Composer.** Round plus button on the left, a wide pill input "Message Mizzou" stretching to the right edge, a send arrow inside the pill's right end once there is text. The plus becomes an X and opens a glass menu with Photo library and Take photo (two file inputs, one with `capture`). Both feed the same flyer upload.
5. **Left panel.** Wordmark and new-chat button; Reminders with a count badge and a glass card of rows; Chats with "Clear all" and the chat list (active one highlighted); bottom glass card with Settings and the user row ("Signed in with Google", chevron). Swipe from the left edge or tap the menu button. Pinned open on wide desktop.
6. **Log out.** Tapping the user row opens a dimmed modal: "Log out of Mizzou?", "Your chats and reminders stay saved for when you come back.", black "Log out", gray "Cancel". Log out ends the session and goes to the landing page.
7. **Clear all chats.** One tap clears everything and shows a 5-second Undo toast. No extra dialog.
8. **Conversation.** Both sides are gray-framed bubbles: the user's on the right with a darker gray fill, Mizzou's on the left in lighter gray glass. No black bubbles. A progress card with checks (done), a dashed spinner (active). The G1 card: program name, "{Department}, {School}", "Yes, that's it" and "Not quite".
9. **Review.** "Got everything. Here's my honest read." Then the "How you match up" card ending in "Want to go for it anyway?" with "Yes, let's apply" and "Not now". Then the "What they ask for" card: rows with a check (clear) or an exclamation (needs a look), a short plain note, and an underlined "Where I found this" link that opens the evidence quote and the source page. An unpublished opening date shows "Opening date isn't posted yet. I'll check again for you and remind you."
10. **Plan and draft.** "Here's the plan. Nothing goes on your calendar until you say so." A timeline card ("Two weeks before / The day it opens / Three days before the deadline"), a draft card with an input "Tell me what to change, like "make it more academic"", then "Approve & Sync" and "Not yet".

The UI never shows scores, percentages, probabilities, model names, token counts, schemas or the words "AI agent".

### 8.3 Voice microcopy

Every user-facing string the agent emits lives in `packages/core/src/voice/` as named constants, so tone stays consistent. Short sentences, first person, warm, no jargon, no emoji, no preaching. Required lines include: "On it. Let me find the right page and see what they ask for." / "Quick check before I go further. Is this the program you mean?" / "Got everything. Here's my honest read." / "That page wouldn't open for me. Can you paste the text?" / "I need a minute." (budget hit) / "I read this page in {language}." Error messages follow the same voice and always include a next step or a link.

## 9. Data, API contracts, budgets, privacy

### 9.1 Supabase tables (migrations in `supabase/migrations/`)

`profiles`, `chats`, `messages`, `runs`, `pages` (cache by URL hash), `extractions`, `opportunities`, `decisions` (gate, decision, opId), `drafts` (versioned), `reminders`, `tasks`, `sync_ledger`, `usage` (model, tokens, latency, estimated cost, user id, run id), `uploads`.

- Row level security on every table: `user_id = auth.uid()`. Cache tables hold only public page text and carry no user data.
- Guests use Supabase anonymous sign-in with the sample profile, so isolation works the same way.
- Clear all chats soft-deletes for 5 seconds (undo window), then hard-deletes chats, messages, runs, drafts and uploads.
- Store UTC plus the original timezone for every date.

### 9.2 Routes

Exactly the route handlers listed in section 3. `api/chat` streams SSE with `maxDuration` at the platform maximum. All inputs and outputs are zod-validated. Uploads: images (jpeg, png, webp) and PDFs, size-capped, stored privately.

### 9.3 Budgets and caching

- Env: `PER_USER_DAILY_USD` (default 1.00), `GLOBAL_DAILY_USD` (default 15), `GUEST_RUNS_PER_DAY` (default 3 per visitor).
- Every `callModel` records cost to `usage` and checks both budgets before the call. When a budget is hit, emit the friendly "I need a minute" message, never a stack trace.
- Cache fetched pages and extractions by URL hash for 24 hours. Cache search results per query for the same window.
- Two recorded sample runs, replayable from stored events, clearly labeled "Recorded run", serve as the live fallback if an API call fails during judging.

### 9.4 Privacy

Store only what the task needs. Never send personal data (profile facts, drafts, uploads, voice) to a contributor variant. Show Forget me for guests and Clear all chats for everyone. Demo data is fictional.

## 10. Evaluation harness (`packages/eval`)

- `cases/*.json`: 10 real opportunities, hand-labeled by the human on or after Oct 27, with the correct values. Mix: clean pages, JavaScript-heavy pages, PDFs, flyers, and two non-academic items (a job posting and a conference call for papers). Graduate programs, scholarships and fellowships are the majority.

```json
{ "id": "case-01", "kind": "program", "input": { "type": "url", "value": "https://..." },
  "expected": { "opens": "2026-09-01T00:00:00Z|null", "deadlines": [{ "label": "...", "iso_utc": "..." }],
                "documents": ["..."], "unusual_rules": ["..."] }, "notes": "" }

```

- `pnpm eval` runs the same `advance` code the app uses, in autonomous mode with gates auto-approved, over all cases. It runs two configurations: **baseline** (single page, no link following) and **deep scan**.
- Metrics, printed and written to `docs/EVAL_REPORT.md` and `docs/eval-results.json`: date exact-match accuracy after timezone normalization (reported as "N of M deadlines correct"), requirement recall and precision with fuzzy matching, evidence validity rate (post-check pass rate), correct `needs_human` flags, buried-rule recovery (found only by deep scan), cost and latency per case.
- Also run the role A/B comparisons from section 4 on the eval set and record the result and the chosen defaults.
- Report only measured numbers in the README and the video. Unit tests (vitest) cover schemas, link ranking, reconcile, timezone handling, the evidence check and `.ics` UID stability.

## 11. Milestones

After each milestone: run it, commit with a small clear message, update `STATUS.md` (done, next, blockers). First commit on or after Oct 27.

| # | Target | Build | Done when |
| --- | --- | --- | --- |
| M0 | Oct 27 | Monorepo scaffold, pnpm workspace, tsconfig, `.env.example`, STATUS.md, Supabase and Vercel wiring. Run the day-one checks from section 4 and write results with working request examples to `docs/META_API_NOTES.md` | A real `/v1/responses` call to `muse-spark-1.3` returns, and the notes file exists |
| M1 | Oct 27 | `callModel` wrapper, role registry, usage logging, 429 backoff, structured output with one repair retry. Extraction schema and single-page extraction with the evidence post-check | One URL in, valid evidenced JSON out, post-check passing |
| M2 | Oct 28 | Eval CLI, 10 labeled cases, baseline run | `pnpm eval` prints a baseline report |
| M3 | Oct 28 | **Thin vertical slice.** Chat UI shell, anonymous guest session, URL in, status lines streaming, G1 card, requirements card, plan card, `.ics` download | A full demo path works end to end, even if plain |
| M4 | Oct 29 | Search grounding, link ranking, parallel fetch, PDF reading, deep scan with budget, resumable runs, reconcile, G2, coverage card | Deep scan beats baseline on the eval set; a run survives a gate sitting open |
| M5 | Oct 30 | Profile by conversation, G3, internal fit and plain-words card, "Want to go for it anyway?" and `decisions`; flyer upload through the `vision` role | Fit matches the human's own judgment on the test set; a flyer produces the same cards |
| M6 | Oct 31 | Drafts, chat edits, versions, G5, Application Pack (checklist, copy-ready answers, recommender and registrar emails, portal button) | A statement is drafted, edited by chat and kept; the Pack screen is complete |
| M7 | Nov 1 | Google sign-in, incremental Calendar consent, idempotent Approve & Sync, `.ics` fallback, reminders that talk back, Coming up card | Three events appear once and never duplicate on retry |
| M8 | Nov 1 | Liquid Glass UI pass to match the screenshots, left panel, log out, Clear all with Undo, budgets, per-visitor caps, recorded runs | UI matches section 8; budgets enforce; recorded runs replay |
| M9 | Nov 2 | Optional, time-boxed: voice notes and SAM 3.1 flyer evidence region. Drop either if it does not work and do not claim it. Human runs five real-user tests; fix what breaks | Either shipped honestly or cut; five short notes saved |
| M10 | Nov 3 | Final eval run, A/B decisions recorded, README, ARCHITECTURE.md, DEMO\_SCRIPT.md, architecture image, demo video shots | README complete, eval report committed |

Nov 4 is buffer only. Submit by midday Lagos time (the deadline is Nov 4, 9:00 PM ET), then reopen the submission to confirm it saved.

## 12. Docs, README and submission

### 12.1 README (for judges)

Sections, in order: what Mizzou is and the one-line pitch ("Mizzou is an autonomous agent that turns a link, a sentence or a flyer into a ready-to-submit application package, with a human approving every step that matters."); live URL and the guest path; **Built during the hackathon** (what was made, with the Oct 27 to Nov 4 window); **Meta models and tools used and where** (every one actually used, with the role and file path, for example `muse-spark-1.3` as orchestrator, reader, judge, writer and vision; search grounding; `muse-voice-transcribe-1.0` and SAM 3.1 only if shipped; Muse Code as the coding agent that built the project); architecture (the agent loop, gates, resumable runs, evidence post-check); evaluation results (measured numbers only, baseline vs deep scan); cost per scan; known limits stated honestly (login-only pages, JavaScript-only pages with paste-text fallback, information that exists only in emails or calls); setup instructions; licenses of the open-source libraries used; roadmap named as next steps and not as features (interview prep, events, general errands, guided fill).

### 12.2 Docs

`docs/META_API_NOTES.md` (verified shapes and examples), `docs/ARCHITECTURE.md` (with the architecture diagram as an image in the repo), `docs/DEMO_SCRIPT.md` (the 3-minute storyboard below), `docs/EVAL_REPORT.md`.

### 12.3 Demo storyboard (3:00, ends on real events in Google Calendar)

| Time | Shot | Line |
| --- | --- | --- |
| 0:00 to 0:25 | The builder, then a messy folder of links and flyers | "I kept missing deadlines and drowning in requirements. So I built Mizzou." |
| 0:25 to 0:50 | Sign in, say what you need in a sentence | "One tap to sign in, then just tell it what you need." |
| 0:50 to 1:25 | Status lines run; G1 confirm | "The agent follows the links a human would, using Muse Spark to decide where to look." |
| 1:25 to 1:50 | Review cards; hover "Where I found this" to show the quote; one flagged ambiguity | "Every date points back to its source. When it is unsure, it asks me." |
| 1:50 to 2:10 | Fit read, "go for it anyway", draft and one chat edit | "It tells me honestly where I stand before I spend my time." |
| 2:10 to 2:35 | Approve & Sync, cut to real Google Calendar with three events | "Nothing is written until I approve." |
| 2:35 to 3:00 | Measured accuracy, a real tester quote, what is next | Use only measured numbers. |

### 12.4 Submission checklist

- Public GitHub repository with the first commit on or after Oct 27 and a clean, small-commit history
- README complete with the sections above, including "Built during the hackathon" and the Meta models and tools list
- Live URL that works with no login (guest path)
- Demo video under 3 minutes
- Short description naming every Meta model and tool actually used
- Architecture image
- Team field: solo
- No secrets in the repo; `.env.example` committed
- Submitted before midday Lagos time on Nov 4, then reopened to verify

### 12.5 Definition of done

Every feature in the demo is real and visible. Gates fire where section 5 says and nowhere else. Every date and requirement has a "Where I found this" link backed by a checked quote. Nothing is ever sent, submitted or logged into on the user's behalf. Budgets hold. The eval report is committed with measured numbers. STATUS.md is current and every milestone is committed.
