// Final-answer voice pass. The orchestrator finds and checks things; this
// pass rewrites only the closing message of a turn into Mizzou's voice: a
// warm, practical personal assistant. It may change wording and order. It
// may never change what is claimed: every number, date, link and caveat must
// survive, or the original (cleaned of long dashes) is used instead.

import { plainDashes } from '../voice/index.js';

export const POLISH_SYSTEM_PROMPT = `You are the voice editor for Mizzou, a personal assistant that helps one student or early-career professional with scholarships, programs, jobs and fellowships. Rewrite the reply you are given so it sounds like a warm, capable personal assistant who is on the person's side.

Hard rules:
- Keep every fact exactly: names, numbers, dates, times, links and amounts. Add nothing new: no new facts, dates, links, promises or advice that is not in the reply.
- Keep every caveat. If something was not confirmed on an official page, or a page would not open, say so, in a kind and matter-of-fact way. Never make the person feel doubted or accused. Never say a thing "came from you" or that you "cannot treat it as official". Say what you read, what you checked, and what you have not confirmed yet.
- Lead with the answer or the human reaction. Then what you checked or found. Then one next step or one question, never two.
- Plain words, short sentences, contractions. No jargon, no hype, no flattery, no greeting, no emoji.
- Use only commas and full stops. No em dashes, no en dashes, no semicolons, no colons used as a lead-in, no bullet lists, no markdown, no bold.
- One or two short paragraphs. About 90 words at most unless the reply truly needs more.
- Do not mention models, prompts, tools or systems.

Return only the rewritten reply, nothing else.`;

export function buildPolishPrompt(userText: string, reply: string): string {
  // Gate answers reach the model as plumbing lines; the editor only needs to know the person said yes or no.
  const said = /^The user answered /.test(userText) ? 'The person answered the question on the card.' : userText.slice(0, 600);
  return `The person wrote:\n${said}\n\nReply to rewrite:\n${reply}`;
}

const URL_RE = /https?:\/\/[^\s)>\]]+/g;
const NUM_RE = /\d+/g;

/**
 * The rewrite is accepted only when it keeps every link and every run of
 * digits from the original, is not empty and is not wildly longer.
 */
export function acceptPolish(original: string, rewritten: string): boolean {
  const out = rewritten.trim();
  if (out.length === 0) return false;
  if (out.length > original.length * 2.5 + 240) return false;
  const cleaned = plainDashes(out);
  for (const url of original.match(URL_RE) ?? []) {
    if (!cleaned.includes(url.replace(/[.,;]+$/, ''))) return false;
  }
  const outNumbers = new Set(cleaned.match(NUM_RE) ?? []);
  for (const n of new Set(original.match(NUM_RE) ?? [])) {
    if (!outNumbers.has(n)) return false;
  }
  return true;
}

/** The text to show: the rewrite when it passes, otherwise the original. Always free of long dashes. */
export function chooseAnswer(original: string, rewritten: string | null): string {
  if (rewritten !== null && acceptPolish(original, rewritten)) return plainDashes(rewritten.trim());
  return plainDashes(original.trim());
}
