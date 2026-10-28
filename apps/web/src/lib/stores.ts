import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// File-backed reminders + chats until Supabase is wired. Same record shapes
// as supabase/migrations/0001_tables.sql; only this module swaps at M7.
// Server-only: import from route handlers, server components and actions.

export interface Reminder {
  id: string;
  userId: string;
  title: string;
  sub: string;
  pill: string;
  dueAt: string | null;
  kind: string;
  done: boolean;
}

export interface ChatSummary {
  id: string;
  userId: string;
  title: string;
  updatedAt: string;
}

function dataDir(): string {
  return process.env.MIZZOU_DATA_DIR ?? join(tmpdir(), 'mizzou');
}

async function readRows<T>(file: string): Promise<T[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(dataDir(), file), 'utf-8'));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'ENOENT') return [];
    throw err;
  }
}

async function writeRows<T>(file: string, rows: T[]): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
  const tmp = join(dataDir(), `${file}.${process.pid}.tmp`);
  await writeFile(tmp, JSON.stringify(rows), 'utf-8');
  await rename(tmp, join(dataDir(), file));
}

async function userRows<T extends { userId: string }>(file: string, userId: string): Promise<T[]> {
  return (await readRows<T>(file)).filter((r) => r.userId === userId);
}

export const remindersStore = {
  async list(userId: string): Promise<Reminder[]> {
    return userRows<Reminder>('reminders.json', userId);
  },

  /** Created only at plan approval or as a check-again reminder (M4/M7). */
  async create(
    userId: string,
    input: Pick<Reminder, 'title' | 'sub' | 'pill'> & Partial<Pick<Reminder, 'dueAt' | 'kind'>>,
  ): Promise<Reminder> {
    const rows = await readRows<Reminder>('reminders.json');
    const row: Reminder = {
      id: crypto.randomUUID(),
      userId,
      title: input.title,
      sub: input.sub,
      pill: input.pill,
      dueAt: input.dueAt ?? null,
      kind: input.kind ?? 'custom',
      done: false,
    };
    await writeRows('reminders.json', [...rows, row]);
    return row;
  },
};

export const chatsStore = {
  async list(userId: string): Promise<ChatSummary[]> {
    const rows = await userRows<ChatSummary>('chats.json', userId);
    return rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  },

  /** Created when a chat starts; titled from the first message or program. */
  async ensure(id: string, userId: string, title: string): Promise<ChatSummary> {
    const rows = await readRows<ChatSummary>('chats.json');
    const existing = rows.find((r) => r.id === id && r.userId === userId);
    if (existing) return existing;
    const row: ChatSummary = { id, userId, title, updatedAt: new Date().toISOString() };
    await writeRows('chats.json', [...rows, row]);
    return row;
  },

  async rename(id: string, userId: string, title: string): Promise<void> {
    const rows = await readRows<ChatSummary>('chats.json');
    await writeRows(
      'chats.json',
      rows.map((r) => (r.id === id && r.userId === userId ? { ...r, title, updatedAt: new Date().toISOString() } : r)),
    );
  },

  /** Clear all; returns the removed rows so the UI can offer Undo. */
  async clear(userId: string): Promise<ChatSummary[]> {
    const rows = await readRows<ChatSummary>('chats.json');
    await writeRows(
      'chats.json',
      rows.filter((r) => r.userId !== userId),
    );
    return rows.filter((r) => r.userId === userId);
  },

  async restore(userId: string, snapshot: ChatSummary[]): Promise<void> {
    const rows = await readRows<ChatSummary>('chats.json');
    const ids = new Set(snapshot.map((r) => r.id));
    await writeRows('chats.json', [...rows.filter((r) => !(r.userId === userId && ids.has(r.id))), ...snapshot]);
  },
};
