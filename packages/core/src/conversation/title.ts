import { z } from 'zod';
import { callModel } from '../meta/callModel.js';

// Chat titles: after the first exchange a small model call writes a 2-4
// word title, unique among the user's chats, saved to chats.title and shown in the panel. The route falls
// back to the first 40 characters when generation fails, so the panel
// never shows a placeholder.

const TitleSchema = z.object({ title: z.string().max(60) });

/** First 40 characters of the opening message. Never empty. */
export function titleFallback(userText: string): string {
  const t = userText.trim().slice(0, 40);
  return t.length > 0 ? t : 'New chat';
}

/** Case-insensitive, whitespace-collapsed key for comparing titles. */
function titleKey(t: string): string {
  return t.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Clean a model title: no quotes, no trailing punctuation, one line. */
export function cleanTitle(raw: string): string {
  return raw
    .replace(/[\r\n]+/g, ' ')
    .replace(/^["'\u201c\u2018\s]+|["'\u201d\u2019\s]+$/g, '')
    .replace(/[.!?:;,\s]+$/g, '')
    .trim()
    .slice(0, 60);
}

/** The title itself when free, otherwise "Title 2", "Title 3"... so every saved chat has its own name. */
export function uniqueTitle(candidate: string, existing: string[]): string {
  const taken = new Set(existing.map(titleKey));
  if (!taken.has(titleKey(candidate))) return candidate;
  for (let n = 2; n < 100; n += 1) {
    const next = `${candidate} ${n}`;
    if (!taken.has(titleKey(next))) return next;
  }
  return candidate;
}

export function buildTitlePrompt(userText: string, assistantText: string, existing: string[] = []): string {
  const used = existing.filter((t) => t.trim() !== '').slice(0, 20);
  return (
    `Write a 2 to 4 word title for this chat. Plain words, no quotes, no trailing punctuation. ` +
    `Name the program or topic first, then what this chat is about.\n` +
    (used.length > 0
      ? `Titles already used (yours must be different from all of these): ${used.join('; ')}\n`
      : '') +
    `User: ${userText.slice(0, 500)}\nAssistant: ${assistantText.slice(0, 500)}`
  );
}

/** Small model call for the title; falls back to the opening message. Always unique among `existing`. */
export async function generateChatTitle(
  userText: string,
  assistantText: string,
  userId = 'dev',
  existing: string[] = [],
): Promise<string> {
  try {
    const result = await callModel({
      role: 'reader',
      systemPrompt: 'Write a 2 to 4 word chat title. Plain words, no quotes, no trailing punctuation. Never reuse a title from the list you are given.',
      prompt: buildTitlePrompt(userText, assistantText, existing),
      schema: TitleSchema,
      temperature: 0,
      userId,
    });
    const data = result.data;
    const title = typeof data === 'object' && data !== null ? cleanTitle(data.title) : '';
    return uniqueTitle(title || titleFallback(userText), existing);
  } catch {
    return uniqueTitle(titleFallback(userText), existing);
  }
}
