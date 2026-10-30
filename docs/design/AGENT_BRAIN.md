# Mizzou agent brain (docs/AGENT_BRAIN.md)

This file replaces every earlier description of how Mizzou understands and replies. Sections 5.1 and 6.1 of PROMPT.md describe the tools and the first step. Where they conflict with this file, this file wins.

## 1. Principle

**Models do the thinking. Code does the guarding.**

Code keeps only what protects the user, the budget and the truth:
- gates G1 to G5 and the rule that nothing external happens without approval
- budgets, turn, page and depth caps, the official-domain filter, robots.txt, rate limits
- the evidence post-check on every extracted field
- never sending email, never submitting, never logging in as the user
- secrets, server-only model calls, row level security

Everything else is the model's job: understanding what the person means, replying, asking questions, deciding which pages to read, explaining fit, planning the preparation schedule, writing drafts, handling languages, explaining failures. No regex or `isUrl` routing on user text. No canned replies for situations that involve the user's goal. A user must be able to say "my prof told me PhD applications in food science open soon at Yale", paste a link, drop a flyer, ask "what do I still need?", say "move that reminder", or just ask for advice, and the same agent handles all of it.

Fixed interface labels (button text, section titles, empty states) stay in the voice module. Anything that describes the user's situation or an opportunity is generated.

## 2. The conversation loop

Every user message runs one orchestrator turn on the model with:
- a versioned system prompt in `packages/core/src/prompts/orchestrator.md`: identity (an agent that works on opportunities for the user), voice (friendly buddy, short sentences, first person, no jargon, no emoji), rules, the gate protocol, the honesty rules (never invent facts, say when unsure, say which page would not open)
- the stored conversation history, a short summary of run state, the profile facts the user has already approved, and the user's current reminders
- the tool schemas

The model decides each turn: answer, ask one question, or call tools. Text streams to the UI as it is generated. Images and flyers go into the same turn as image input. Cards appear when tools return structured results (program match, requirements, plan, draft, pack), and the model writes the surrounding text.

Tools: `web_search` (built-in grounding, keep citations), `fetch_page`, `find_links` (code ranking, advisory only), `read_pdf`, `read_page` (reader role), `list_reminders`, `propose_plan`, `ask_profile_question`, `draft_document`, `request_approval`, `finish`. The model picks and sequences them. Code validates every tool input and output.

## 3. Which model does which job

| Job | Model | Why it fits | Rule |
|---|---|---|---|
| Conversation and tool loop (orchestrator) | `muse-spark-1.3`, medium reasoning | Tool calling, search grounding, fast | A/B `muse-wonder-1.0` on one long run, keep the winner |
| Page reading into the schema (reader) | `muse-spark-1.3`, low reasoning | Many parallel calls, cheap | Contributor variant only on public page text, behind a flag |
| Flyers and screenshots (vision) | `muse-spark-1.3` with image input | Reads the flyer text directly | Same schema and evidence rules |
| Reconcile conflicts, fit read, preparation strategy (judge, planner) | `muse-wonder-1.0`, high reasoning | Hardest reasoning in the product | Keep Wonder only if it beats Spark on the labeled set |
| Statements, emails, edits (writer) | `muse-wonder-1.0` | Writing quality | Compare three samples side by side before locking |
| "Where I found this" region on a flyer | SAM 3.1 | Segments the text region that holds a date | Time-box 90 minutes. Keep it only if it works on 3 of 5 flyers |
| Voice notes in the composer | `muse-voice-transcribe-1.0` | Dictation for a conversational agent, 25 languages | 60-second cap, transcript editable before sending |
| UI exploration (build time) | `muse-wonder-1.0` | Generates component code from tokens and screenshots | Script in `scripts/`, output in `docs/design/wonder/`, a human reviews before anything is merged |

Not used: Muse Image, Muse Glimmer, Wonder Full. They have no job in the product. Do not add them. Every model named in the README must be used in the shipped product or the documented build process.

Personal data (profile facts, drafts, uploads, voice) never goes to a contributor variant.

## 4. The preparation plan is generated

No fixed offsets. `propose_plan` asks the planner model for a strategy from the real deadline, the documents still missing, the user's profile and how much time is left. Code validates the output: every reminder is dated before the deadline, every date traces to an extracted field, nothing is scheduled in the past, timezones are kept. The user sees it at gate G4.

## 5. Tests that keep it honest

- Eval adds conversational cases: no link at all, a vague request, a follow-up question, an edit request, a message in another language, a flyer. Each must produce a sensible model-driven reply and the right tool calls.
- A guard test fails if the chat route or the orchestrator branches on user message text with a regex or URL check.
- Per-call usage (role, model, tokens, cost) is logged and printed per run. A run whose orchestrator turns cost $0 fails the test.
- Report measured A/B results in `docs/EVAL_REPORT.md` and keep the model assignment table above in sync with them.

## 6. Cost

A message turn on Spark costs roughly one cent. A deep scan stays under about $0.15 on Spark readers. Wonder is used only where the table says so, so the judge and writer calls stay few. Development spend cap is raised from $10 to $40. The in-code guards (per-user daily, global daily, guest runs) stay on and are what protects the credits during judging.
