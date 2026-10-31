// Persistence behind one repository interface. Supabase-only: every caller
// is signed in (Google), so RLS rows through the user's session. Tests use
// the in-memory repo. Server-only: route handlers, server actions and
// scripts with a key.

import 'server-only';

import { newRun, type GateDecision, type RunRecord, type UsageRecord } from '@mizzou/core';
import type { ChatSummary, Reminder } from './stores.ts';

export interface RunLedger {
  load(id: string): Promise<RunRecord | null>;
  save(run: RunRecord): Promise<void>;
}

export type ReminderInput = Pick<Reminder, 'title' | 'sub' | 'pill'> &
  Partial<Pick<Reminder, 'dueAt' | 'kind'>>;

export interface UsageSnapshot {
  userSpend: number;
  globalSpend: number;
}

export interface Repo {
  runs: RunLedger;
  reminders: {
    list(userId: string): Promise<Reminder[]>;
    create(userId: string, input: ReminderInput): Promise<Reminder>;
    /** Delete every reminder for a user. Returns the deleted count. */
    clear(userId: string): Promise<number>;
    /** Mark one reminder done. Throws when the id is not yours. */
    setDone(userId: string, id: string): Promise<void>;
    /** Push one reminder out by N days (default 7). Throws when the id is not yours. */
    snooze(userId: string, id: string, days?: number): Promise<void>;
  };
  chats: {
    list(userId: string): Promise<ChatSummary[]>;
    ensure(id: string, userId: string, title: string): Promise<ChatSummary>;
    rename(id: string, userId: string, title: string): Promise<void>;
    clear(userId: string): Promise<ChatSummary[]>;
    restore(userId: string, snapshot: ChatSummary[]): Promise<void>;
  };
  usage: {
    /** Spend since UTC midnight for one user and for everyone. */
    snapshot(userId: string): Promise<UsageSnapshot>;
    /** Persist completed model calls (usage table, PROMPT 9.3). */
    flush(rows: UsageRecord[], runId?: string): Promise<void>;
  };
  syncLedger: {
    /** Idempotent calendar-event write (unique on user_id + event_id). */
    upsert(
      userId: string,
      rows: Array<{ eventId: string; provider: string; status: string; payload: unknown }>,
    ): Promise<void>;
  };
}

// ---------------------------------------------------------------------------
// Minimal database seam. The real Supabase client satisfies this structurally
// (adapted with one cast); fakes implement it directly in tests.

export interface DbResult<T> {
  data: T | null;
  error: { message: string } | null;
}

export interface DbQuery<T = unknown> extends PromiseLike<DbResult<T>> {
  eq(col: string, val: unknown): DbQuery<T>;
  is(col: string, val: null): DbQuery<T>;
  gte(col: string, val: string): DbQuery<T>;
  order(col: string, opts?: { ascending?: boolean }): DbQuery<T>;
  limit(n: number): DbQuery<T>;
  select(cols?: string): DbQuery<T>;
  single(): Promise<DbResult<unknown>>;
}

export interface DbTable {
  select(cols?: string): DbQuery<Record<string, unknown>[]>;
  insert(rows: unknown[]): DbQuery<Record<string, unknown>[]>;
  update(patch: unknown): DbQuery<Record<string, unknown>[]>;
  upsert(rows: unknown[], opts?: { onConflict?: string }): DbQuery<Record<string, unknown>[]>;
  delete(): DbQuery<Record<string, unknown>[]>;
}

export interface DbClient {
  from(table: string): DbTable;
}

function dayStartUtc(): string {
  return `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
}

// ---------------------------------------------------------------------------
// Supabase backend. Every query carries the user's own id; RLS owner
// policies enforce it. Dates are ISO strings; numerics arrive as numbers.

type RunRow = Record<string, unknown>;

function toRunRecord(row: RunRow, decisions: GateDecision[]): RunRecord {
  const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
  const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));
  return {
    id: str(row['id']),
    userId: typeof row['user_id'] === 'string' ? (row['user_id'] as string) : null,
    chatId: typeof row['chat_id'] === 'string' ? (row['chat_id'] as string) : null,
    status: row['status'] === 'needs_approval' || row['status'] === 'done' || row['status'] === 'failed' ? row['status'] : 'running',
    turnCount: num(row['turn_count']),
    messages: Array.isArray(row['messages']) ? (row['messages'] as unknown[]) : [],
    state:
      row['state'] && typeof row['state'] === 'object' && !Array.isArray(row['state'])
        ? (row['state'] as Record<string, unknown>)
        : {},
    pendingGate:
      row['pending_gate'] && typeof row['pending_gate'] === 'object'
        ? (row['pending_gate'] as RunRecord['pendingGate'])
        : null,
    decisions,
    usageUsd: num(row['usage_usd']),
    updatedAt: str(row['updated_at'], new Date().toISOString()),
  };
}

function toReminder(row: RunRow, userId: string): Reminder {
  const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
  return {
    id: str(row['id']),
    userId,
    title: str(row['title']),
    sub: str(row['status_line']),
    pill: str(row['pill']),
    dueAt: typeof row['due_at'] === 'string' ? (row['due_at'] as string) : null,
    kind: str(row['kind'], 'custom'),
    done: row['done'] === true,
  };
}

function toChat(row: RunRow, userId: string): ChatSummary {
  const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
  return {
    id: str(row['id']),
    userId,
    title: str(row['title'], 'New chat'),
    updatedAt: str(row['created_at'], new Date().toISOString()),
  };
}

export function supabaseRepo(db: DbClient): Repo {
  const runs: RunLedger = {
    load: async (id) => {
      const res = await db.from('runs').select('*').eq('id', id).limit(1);
      const row = res.data?.[0];
      if (!row) return null;
      const dres = await db.from('decisions').select('gate,decision,op_id').eq('run_id', id);
      const decisions: GateDecision[] = (dres.data ?? []).map((d) => ({
        gate: d['gate'] as GateDecision['gate'],
        decision: d['decision'],
        opId: typeof d['op_id'] === 'string' ? (d['op_id'] as string) : '',
      }));
      return toRunRecord(row, decisions);
    },
    save: async (run) => {
      await db.from('runs').upsert(
        [
          {
            id: run.id,
            user_id: run.userId,
            chat_id: run.chatId,
            status: run.status,
            messages: run.messages,
            state: run.state,
            pending_gate: run.pendingGate,
            turn_count: run.turnCount,
            usage_usd: run.usageUsd,
          },
        ],
        { onConflict: 'id' },
      );
      if (run.userId && run.decisions.length > 0) {
        await db.from('decisions').upsert(
          run.decisions.map((d) => ({
            user_id: run.userId,
            run_id: run.id,
            gate: d.gate,
            decision: d.decision,
            op_id: d.opId,
          })),
          { onConflict: 'user_id,op_id' },
        );
      }
    },
  };

  return {
    runs,
    reminders: {
      list: async (userId) => {
        const res = await db
          .from('reminders')
          .select('*')
          .eq('user_id', userId)
          .eq('done', false)
          .order('due_at', { ascending: true });
        return (res.data ?? []).map((r) => toReminder(r, userId));
      },
      create: async (userId, input) => {
        const res = await db
          .from('reminders')
          .insert([
            {
              user_id: userId,
              title: input.title,
              status_line: input.sub,
              pill: input.pill,
              due_at: input.dueAt ?? null,
              kind: input.kind ?? 'custom',
              done: false,
            },
          ])
          .select('*')
          .single();
        if (!res.data || res.error) throw new Error('Could not save the reminder.');
        return toReminder(res.data as RunRow, userId);
      },
      setDone: async (userId, id) => {
        const res = await db.from('reminders').update({ done: true }).eq('user_id', userId).eq('id', id).select('id');
        if (res.error || (res.data?.length ?? 0) === 0) throw new Error('Could not update the reminder.');
      },
      snooze: async (userId, id, days = 7) => {
        const due = new Date(Date.now() + days * 86400000).toISOString();
        const res = await db.from('reminders').update({ due_at: due, snoozed_until: due }).eq('user_id', userId).eq('id', id).select('id');
        if (res.error || (res.data?.length ?? 0) === 0) throw new Error('Could not snooze the reminder.');
      },
      clear: async (userId) => {
        const res = await db.from('reminders').delete().eq('user_id', userId).select('id');
        if (res.error) throw new Error('Could not delete reminders.');
        return res.data?.length ?? 0;
      },
    },
    chats: {
      list: async (userId) => {
        const res = await db
          .from('chats')
          .select('*')
          .eq('user_id', userId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false });
        return (res.data ?? []).map((r) => toChat(r, userId));
      },
      ensure: async (id, userId, title) => {
        const found = await db.from('chats').select('*').eq('id', id).eq('user_id', userId).limit(1);
        if (found.data?.[0]) return toChat(found.data[0], userId);
        const res = await db.from('chats').insert([{ id, user_id: userId, title }]).select('*').single();
        if (!res.data || res.error) throw new Error('Could not start the chat.');
        return toChat(res.data as RunRow, userId);
      },
      rename: async (id, userId, title) => {
        await db.from('chats').update({ title }).eq('id', id).eq('user_id', userId);
      },
      clear: async (userId) => {
        const res = await db.from('chats').select('*').eq('user_id', userId).is('deleted_at', null);
        const removed = (res.data ?? []).map((r) => toChat(r, userId));
        await db.from('chats').update({ deleted_at: new Date().toISOString() }).eq('user_id', userId).is('deleted_at', null);
        return removed;
      },
      restore: async (userId, snapshot) => {
        const ids = snapshot.map((r) => r.id);
        for (const id of ids) {
          await db.from('chats').update({ deleted_at: null }).eq('id', id).eq('user_id', userId);
        }
      },
    },
    usage: {
      snapshot: async (userId) => {
        const res = await db.from('usage').select('user_id,cost_usd').gte('created_at', dayStartUtc());
        let userSpend = 0;
        let globalSpend = 0;
        for (const r of res.data ?? []) {
          const cost = typeof r['cost_usd'] === 'number' ? r['cost_usd'] : Number(r['cost_usd'] ?? 0);
          if (!Number.isFinite(cost)) continue;
          globalSpend += cost;
          if (r['user_id'] === userId) userSpend += cost;
        }
        return { userSpend, globalSpend };
      },
      flush: async (rows, runId) => {
        if (rows.length === 0) return;
        await db.from('usage').insert(
          rows.map((r) => ({
            user_id: r.userId,
            run_id: runId ?? null,
            model: r.model,
            prompt_tokens: r.promptTokens,
            completion_tokens: r.completionTokens,
            total_tokens: r.promptTokens + r.completionTokens,
            latency_ms: 0,
            cost_usd: r.costUsd,
          })),
        );
      },
    },
    syncLedger: {
      upsert: async (userId, rows) => {
        if (rows.length === 0) return;
        await db.from('sync_ledger').upsert(
          rows.map((r) => ({
            user_id: userId,
            event_id: r.eventId,
            provider: r.provider,
            status: r.status,
            payload: r.payload,
          })),
          { onConflict: 'user_id,event_id' },
        );
      },
    },
  };
}

/** Structural bridge: the real client has everything DbClient needs and more. */
export function adaptDb(client: { from(table: string): unknown }): DbClient {
  return { from: (table) => client.from(table) as unknown as DbTable };
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** In-memory repo for tests. Same shapes and counting rule throughout. */
export function memoryRepo(): Repo {
  const runRows = new Map<string, RunRecord>();
  const reminderRows = new Map<string, Reminder>();
  const chatRows = new Map<string, ChatSummary>();
  const usageRows: UsageRecord[] = [];
  const ledgerRows = new Map<string, { eventId: string; userId: string }>();
  return {
    runs: {
      load: async (id) => runRows.get(id) ?? null,
      save: async (run) => {
        runRows.set(run.id, JSON.parse(JSON.stringify(run)) as RunRecord);
      },
    },
    reminders: {
      list: async (userId) => [...reminderRows.values()].filter((r) => r.userId === userId && !r.done),
      create: async (userId, input) => {
        const row: Reminder = {
          id: `mem-${reminderRows.size + 1}`,
          userId,
          title: input.title,
          sub: input.sub,
          pill: input.pill,
          dueAt: input.dueAt ?? null,
          kind: input.kind ?? 'custom',
          done: false,
        };
        reminderRows.set(row.id, row);
        return row;
      },
      setDone: async (userId, id) => {
        const row = reminderRows.get(id);
        if (!row || row.userId !== userId) throw new Error('Could not update the reminder.');
        reminderRows.set(id, { ...row, done: true });
      },
      snooze: async (userId, id, days = 7) => {
        const row = reminderRows.get(id);
        if (!row || row.userId !== userId) throw new Error('Could not snooze the reminder.');
        reminderRows.set(id, { ...row, dueAt: new Date(Date.now() + days * 86400000).toISOString() });
      },
      clear: async (userId) => {
        let n = 0;
        for (const [id, r] of reminderRows) {
          if (r.userId === userId) {
            reminderRows.delete(id);
            n += 1;
          }
        }
        return n;
      },
    },
    chats: {
      list: async (userId) =>
        [...chatRows.values()]
          .filter((c) => c.userId === userId)
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
      ensure: async (id, userId, title) => {
        const existing = chatRows.get(`${userId}:${id}`);
        if (existing) return existing;
        const row: ChatSummary = { id, userId, title, updatedAt: new Date().toISOString() };
        chatRows.set(`${userId}:${id}`, row);
        return row;
      },
      rename: async (id, userId, title) => {
        const row = chatRows.get(`${userId}:${id}`);
        if (row) chatRows.set(`${userId}:${id}`, { ...row, title, updatedAt: new Date().toISOString() });
      },
      clear: async (userId) => {
        const removed = [...chatRows.values()].filter((c) => c.userId === userId);
        for (const r of removed) chatRows.delete(`${userId}:${r.id}`);
        return removed;
      },
      restore: async (userId, snapshot) => {
        for (const r of snapshot) chatRows.set(`${userId}:${r.id}`, { ...r, userId });
      },
    },
    usage: {
      snapshot: async (userId) => {
        const day = todayStamp();
        let userSpend = 0;
        let globalSpend = 0;
        for (const r of usageRows) {
          if (r.at.slice(0, 10) !== day) continue;
          globalSpend += r.costUsd;
          if (r.userId === userId) userSpend += r.costUsd;
        }
        return { userSpend, globalSpend };
      },
      flush: async (rows) => {
        usageRows.push(...rows.map((r) => ({ ...r })));
      },
    },
    syncLedger: {
      upsert: async (userId, rows) => {
        for (const r of rows) ledgerRows.set(`${userId}:${r.eventId}`, { ...r, userId });
      },
    },
  };
}

/**
 * The repo for this request: Supabase under the user's session (RLS rows).
 * Throws AuthRequiredError when signed out. The Next-dependent modules load
 * lazily so this file's static graph stays runnable under plain node:test
 * (only repo(), never called by tests, touches them).
 */
export async function repo(): Promise<Repo> {
  const { resolveUser } = await import('./auth.ts');
  await resolveUser();
  const { supabaseServer } = await import('./supabase/server.ts');
  return supabaseRepo(adaptDb(await supabaseServer()));
}

export { newRun };
export type { RunRecord };
