import { z } from 'zod';
import { callModel } from '../meta/callModel.js';

// Chat titles: after the first exchange a small model call writes a 3-6
// word title, saved to chats.title and shown in the panel. The route falls
// back to the first 40 characters when generation fails, so the panel
// never shows a placeholder.

const TitleSchema = z.object({ title: z.string().max(60) });

/** First 40 characters of the opening message. Never empty. */
export function titleFallback(userText: string): string {
  const t = userText.trim().slice(0, 40);
  return t.length > 0 ? t : 'New chat';
}

export function buildTitlePrompt(userText: string, assistantText: string): string {
  return (
    `Write a 3 to 6 word title for this chat. Plain words, no quotes, no trailing punctuation.\n` +
    `User: ${userText.slice(0, 500)}\nAssistant: ${assistantText.slice(0, 500)}`
  );
}

/** Small model call for the title; falls back to the opening message. */
export async function generateChatTitle(userText: string, assistantText: string, userId = 'dev'): Promise<string> {
  try {
    const result = await callModel({
      role: 'reader',
      systemPrompt: 'Write a 3 to 6 word chat title. Plain words, no quotes, no trailing punctuation.',
      prompt: buildTitlePrompt(userText, assistantText),
      schema: TitleSchema,
      temperature: 0,
      userId,
    });
    const data = result.data;
    const title = typeof data === 'object' && data !== null ? data.title.trim() : '';
    if (!title) return titleFallback(userText);
    return title.slice(0, 60);
  } catch {
    return titleFallback(userText);
  }
}
