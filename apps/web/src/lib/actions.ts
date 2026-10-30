'use server';

import { resolveUser } from './auth';
import { repo } from './repo';
import type { ChatSummary, Reminder } from './stores';

// Server actions for app chrome state. No secrets; identity comes from
// resolveUser (Supabase Google session, throws when signed out) and rows
// come from the repo (Supabase under RLS).

export interface AppData {
  userId: string;
  name: string | null;
  email: string | null;
  reminders: Reminder[];
  chats: ChatSummary[];
}

export async function getAppData(): Promise<AppData> {
  const { userId, name, email } = await resolveUser();
  const db = await repo();
  const [reminders, chats] = await Promise.all([db.reminders.list(userId), db.chats.list(userId)]);
  return { userId, name, email, reminders, chats };
}

export async function ensureChatAction(id: string, title: string): Promise<ChatSummary> {
  const { userId } = await resolveUser();
  return (await repo()).chats.ensure(id, userId, title.slice(0, 60));
}

export async function refreshChatsAction(): Promise<ChatSummary[]> {
  const { userId } = await resolveUser();
  return (await repo()).chats.list(userId);
}

export interface DeletedData {
  chats: number;
  reminders: number;
}

export async function deleteMyDataAction(): Promise<DeletedData> {
  const { userId } = await resolveUser();
  const db = await repo();
  const chats = await db.chats.clear(userId);
  const reminders = await db.reminders.clear(userId);
  return { chats: chats.length, reminders };
}

export async function clearChatsAction(): Promise<ChatSummary[]> {
  const { userId } = await resolveUser();
  return (await repo()).chats.clear(userId);
}

export async function restoreChatsAction(snapshot: ChatSummary[]): Promise<void> {
  const { userId } = await resolveUser();
  await (await repo()).chats.restore(userId, snapshot);
}
