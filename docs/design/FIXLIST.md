# Mizzou fix list, Oct 30 (docs/design/FIXLIST.md)

Order of work is P0, then P1, then P2. Commit each numbered item separately with a 3-line summary. Update the top of STATUS.md (it is stale: it still says "STOPPED for host screenshots") and record what is actually done. Tell the human exactly which URLs to check after P0, after P1 and after P2. No secrets printed. Estimate before any paid run.

## P0. The product must work on the live URL

1. **No local files in production.** The agent fails on Vercel ("Something went wrong on my side") because file-backed stores cannot persist there. Replace file stores for chats, messages, runs, decisions, reminders, usage and chat titles with Supabase through the user's session and RLS (the migrations already exist). Keep one repository interface with an in-memory implementation for tests. Delete the file stores once Supabase is the only path.
2. **Stateless model calls.** Stop chaining on `previous_response_id`: it flakes across turns. Store the message history in Supabase and send the needed history on every orchestrator call. This also works on serverless.
3. **Errors are visible to the developer, not to the user.** Log the real error server-side with a short error id and show the user a friendly line with that id. Add `/api/health` that returns booleans only for each required env var, so the human can confirm Vercel is configured. Set `maxDuration` to the plan's maximum and keep the resumable loop.
4. **Google sign-in only. No guests.** Remove "Look around as a guest", anonymous sign-in, guest caps and the guest user row everywhere. Landing "Try it for free" and "Log in" both go to `/signup`, where the single button is "Continue with Google". Unauthenticated visits to `/app` redirect to `/signup`. Sign-out calls Supabase sign-out and returns to `/`. Fix the callback so signup and login are the same flow (Google creates the account on first sign-in). Show the real Google name and email in the panel.
5. **Budget caps.** The local "I need a minute." was the budget guard (dev env had 0.50 per user and 5 global). Read caps from env, keep usage in the Supabase `usage` table so caps survive serverless, and show different friendly text for "daily limit reached" versus "I need a minute". Suggested dev values: per user 5, global 25.

## P1. Conversation that feels like a person

6. **Separate bubbles.** Every assistant message the model produces is its own bubble, in order, appended as it arrives. Never merge two messages into one bubble (the screenshots show "...find the open date.I know from a quick search..." glued together). Same-sender bubbles sit 4px apart, groups 12px apart. A subtle typing indicator shows while the model works. Bubbles have no length limit.
7. **Tool progress.** Show tool steps as one compact row between bubbles, updated in place with a spinner then a check, collapsing to a one-line summary ("Read 3 pages") that expands on tap. Never repeat or duplicate rows.
8. **Order.** A card appears after the bubble that introduces it. The model never says "above" or "below" or refers to layout (the screenshots show "Checklist is set above" with the card below). Add this to the prompt and to a test over sample outputs.
9. **Voice.** Rewrite `prompts/orchestrator.md`: a sharp personal assistant texting a friend. Natural, warm, specific, short paragraphs, plain words, answers first, then at most one question. Contractions, no corporate phrasing. Hidden machinery never appears in user text: no "G1", "approval", "gate", "schema", "logged", "user-provided", "confidence", "tool", model names, or "I will log that". Never narrate internal steps; say what was found and what happens next. Never repeat the same point in two bubbles. Facts about opportunities come only from fetched pages or search results, with the source named in plain words; when unsure, say so. Include 3 style examples (tone only, no factual claims about real programs). Add eval conversational cases and a test that fails on banned terms in outputs.
10. **Plan card and calendar.** The model proposes the plan (per docs/AGENT_BRAIN.md section 4). Show dates in the user's local timezone first, with the original zone in muted text. "AOE" means Anywhere on Earth, UTC-12; map it to a fixed offset instead of passing it to luxon as a zone (the invalid zone is the likely cause of "Could not build the calendar file"). Log the real ICS error, fix it, add tests for AOE and other abbreviations. Calendar errors appear as a small inline message under the button, never as another card. The plan card has a clear title, one row per reminder with date and purpose, then "Approve & Sync" and ".ics" actions.
11. **Chat titles.** After the first exchange, a small model call writes a short title (3 to 6 words). Save it to `chats.title` in Supabase and show it in the panel. Fallback while waiting: the first 40 characters of the first message. No placeholder titles like "Conversation".

## P2. Layout and polish

12. **Top bar.** Solid white, never translucent, with a 1px bottom border once scrolled, so text never shows through the wordmark. Desktop and tablet: the wordmark at the top-left of the left gutter with the panel icon directly beneath it; new chat at the top-right; nothing centered. Mobile (adaptation): one row, wordmark left, panel icon and new chat right. The chat column starts below the bar with 72px of top padding so nothing slides under it.
13. **Panel (premium layout).**
   - Opens on hover over the panel icon or the left edge on pointer devices, closes 250ms after the pointer leaves; a click makes it stay open until Esc or an outside click. On touch devices, tap opens and closes. Always an overlay: the chat column never moves.
   - White card, 320px on desktop (inset 16px, radius 24px, large soft shadow), full-height drawer under 768px.
   - Remove the wordmark, the "Settings" text row, the chevrons and any placeholder content from the panel.
   - Contents: a full-width "New chat" button; a search field ("Search chats") that filters titles; Reminders only when at least one exists; Chats grouped Today, Yesterday, Previous 7 days, Older, showing the saved titles, the active chat highlighted, a "⋯" on hover with Rename and Delete; "Clear all" in the group header only when chats exist (5-second Undo).
   - Footer: avatar, name and email on the left, a settings icon button (icon only) on the right.
14. **Settings modal in the Muse layout, in the light theme.** Clicking the settings icon opens a centered dialog about 760 by 520 with a left nav (General, Help & support, Legal & safety) and, at the bottom of the nav, Log out; content on the right under the section title; close button top-right; Esc closes. General: account card (avatar, name, email, "Signed in with Google"), Google Calendar connection status, Clear all chats. Help & support: how Mizzou works in three short lines and a feedback link to the repo's issues page. Legal & safety: Terms, Privacy, what Mizzou stores, and a "Delete my data" action. Mobile: full-screen sheet with the nav as a list on top.
15. **Composer.** Remove the inner input outline (the blue rectangle inside the pill). On focus-within the whole pill gets a 1px Meta Blue border. Send button turns Meta Blue when there is text.
16. **Landing and sign-up copy** to match: the guest button is gone, Google is the only action.

## Acceptance (the human checks, on the live Vercel URL and on localhost)

- Sign up with Google from `/signup`, land in `/app`, refresh and stay signed in, log out, log in again.
- "im interested in harvard masters in computer science, when does the application open?" gets a human reply in separate bubbles, a visible tool row, a follow-up bubble if needed, no jargon, no "above/below", no duplicates, and a persistent chat titled in the panel.
- The EPFL link flow completes with a plan card whose times are in local time, and the ICS downloads.
- Wordmark never overlaps text. Composer has no inner outline. Panel opens on hover and by click. Settings opens the Muse-style dialog.
- `/api/health` on Vercel lists every env var as present.
