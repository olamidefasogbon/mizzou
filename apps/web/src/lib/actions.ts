'use server';

import { resolveUser } from './auth';
import { repo } from './repo';
import type { ChatSummary, Reminder } from './stores';

// Server actions for app chrome state. No secrets; identity comes from
// resolveUser (Supabase session when signed in, anon cookie otherwise) and
// rows come from the repo (Supabase under RLS, file-backed for visitors).

export interface AppData {
  userId: string;
  name: string | null; // null until auth/profile lands (M7) — guests see "Howdy"
  reminders: Reminder[];
  chats: ChatSummary[];
}

export async function getAppData(): Promise<AppData> {
  const { userId } = await resolveUser();
  const db = await repo();
  const [reminders, chats] = await Promise.all([db.reminders.list(userId), db.chats.list(userId)]);
  return { userId, name: null, reminders, chats };
}

export async function ensureChatAction(id: string, title: string): Promise<ChatSummary> {
  const { userId } = await resolveUser();
  return (await repo()).chats.ensure(id, userId, title.slice(0, 60));
}

export async function clearChatsAction(): Promise<ChatSummary[]> {
  const { userId } = await resolveUser();
  return (await repo()).chats.clear(userId);
}

export async function restoreChatsAction(snapshot: ChatSummary[]): Promise<void> {
  const { userId } = await resolveUser();
  await (await repo()).chats.restore(userId, snapshot);
}
