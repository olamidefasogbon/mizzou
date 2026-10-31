# Mizzou

**From link to executed application.**

Mizzou is an autonomous agent for students and early-career professionals who chase opportunities with deadlines: fellowships, scholarships, graduate programs, grants, internships and jobs. You give it a link, a sentence or a photo of a flyer. It reads the official source, finds the rules buried in FAQs and PDFs, proves every date it reports, tells you honestly whether you fit, plans your preparation, drafts your materials, and puts the schedule on your calendar. You approve every step that matters.

Mizzou is built on Meta's Muse models. The chat and the Liquid Glass interface are how you talk to the agent. They are not the product.

**No signup required:** anyone can use Mizzou for free — opening the app mints an anonymous session silently. An optional Google account keeps your chats and syncs your calendar (linking preserves everything, including approvals made as a guest).

## The problem

High-potential applicants lose opportunities to application fatigue, not lack of talent. Rules are scattered across program pages, FAQs and PDFs. Deadlines differ by track and timezone. Opening dates are often unpublished. Every application needs its own essay. Students without an advisor do this alone, for dozens of opportunities at once.

## What Mizzou does

1. **Understands the goal** from a sentence, a link or a flyer image.
2. **Finds the official source** and asks you to confirm the match before spending effort.
3. **Reads the whole official site** like a person would: the program page, then the FAQ, eligibility, guidelines and linked PDFs, following links in a tool-calling loop with a fixed page budget.
4. **Extracts dates and requirements with evidence.** Every field carries a source URL and an exact quote. A code check re-reads the quote and confirms it supports the value before the field is trusted.
5. **Reconciles conflicts and flags uncertainty.** When two pages disagree, or a date has no timezone, or the opening date is not published, Mizzou says so and asks. It never guesses.
6. **Gives an honest fit read** against a profile built through conversation, then asks once: "Want to go for it anyway?" Fit is advice. The decision is yours.
7. **Plans and drafts.** A reminder plan, a first draft of your statement, and an Application Pack: checklist, copy-ready answers, recommender and registrar email drafts, and the link to the real portal.
8. **Follows through.** Reminders come back to the conversation when a task is due.

## Human in the loop

The agent works alone on anything read-only or reversible and stops only at gates.

| Gate | When | What you decide |
|---|---|---|
| G1 | Always | Is this the right program? |
| G2 | Only when flagged | Which source is right when dates or rules conflict |
| G3 | Once per task | Which facts about you the agent may use |
| G4 | Always | Approve & Sync: nothing touches your calendar before this |
| G5 | Always | Keep or edit each draft |

Mizzou never sends email, never submits an application, and never logs into a portal as you. When a page blocks automated readers, needs JavaScript or sits behind a login, it tells you which page and asks you to paste the text. It respects robots.txt and each site's terms.

## Meta models and tools used

| Model or tool | Where | Role |
|---|---|---|
| `muse-spark-1.3` (Meta Model API) | `packages/core/src/meta` | Orchestrator, page reader, judge, writer, flyer vision |
| Muse Code | development | The coding agent that built this project |

<!-- Add a row only when it ships and is shown in the demo: search grounding (M4), muse-voice-transcribe-1.0 (M9), SAM 3.1 flyer evidence region (M9). -->

## Evaluation

Measured on a labeled set of 10 real opportunities (programs, fellowships, an internship board, PDFs and flyers), reported as baseline (single page) versus deep scan (link-following).

| Metric | Baseline | Deep scan |
|---|---|---|
| Deadlines correct | to be measured | to be measured |
| Requirement recall | to be measured | to be measured |
| Evidence validity | to be measured | to be measured |

Numbers appear here only when measured. See `docs/EVAL_REPORT.md`.

## Architecture

```
apps/web         Next.js app: the agent's interface (chat, overlays, approvals)
packages/core    The agent: tool loop, gates, run state, evidence checks, model client
packages/eval    Labeled cases, fixtures, scoring, baseline vs deep scan
supabase         Tables and row-level security
docs             Design specs, API notes, eval report
```

Runs are stored, so a gate can stay open for days and a platform timeout never loses work.

## Run it

```
pnpm install
pnpm dev
```

Set the variable names from `.env.example` in your shell environment, or copy it to `.env.local` (git-ignored). Never commit keys.

## Known limits

- Pages that need a login, or that render only with JavaScript, cannot be read automatically. Mizzou says which page and asks for pasted text.
- Information that exists only in emails or phone calls is out of reach.
- Application forms sit behind logins, so Pack answers are built from public requirements and marked "check against the portal" where unconfirmed.

## Status

| Area | State |
|---|---|
| Model client, budget guard, evidence checks, eval harness | Built |
| Single-page extraction with evidence | Built |
| Responsive interface shell, empty states | In progress |
| Tool-calling deep scan, resumable runs, gates | Next |
| Fit read, drafts, Application Pack | Planned |
| Google Calendar sync, reminders | Planned |

## Built during the hackathon

Everything in this repository was built between Oct 27 and Nov 4, 2026, for the Meta Model API hackathon (Indie track), using Muse Code. Open-source libraries are used under their own licenses.
