'use server';

import { anonId } from './session';
import { chatsStore, remindersStore, type ChatSummary } from './stores';

// Server actions for app chrome state. No secrets; the per-browser anon id
// comes from the cookie the middleware sets.

export interface AppData {
  userId: string;
  name: string | null; // null until auth/profile lands (M7) — guests see "Howdy"
  reminders: Awaited<ReturnType<typeof remindersStore.list>>;
  chats: ChatSummary[];
}

export async function getAppData(): Promise<AppData> {
  const userId = await anonId();
  const [reminders, chats] = await Promise.all([remindersStore.list(userId), chatsStore.list(userId)]);
  return { userId, name: null, reminders, chats };
}

export async function ensureChatAction(id: string, title: string): Promise<ChatSummary> {
  const userId = await anonId();
  return chatsStore.ensure(id, userId, title.slice(0, 60));
}

export async function clearChatsAction(): Promise<ChatSummary[]> {
  return chatsStore.clear(await anonId());
}

export async function restoreChatsAction(snapshot: ChatSummary[]): Promise<void> {
  await chatsStore.restore(await anonId(), snapshot);
}
