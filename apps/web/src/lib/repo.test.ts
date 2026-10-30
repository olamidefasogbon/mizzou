// Mocked Supabase backend tests (Part A step 6): the full Repo contract
// against a fake DbClient that executes the query filters in memory.
// Row-level isolation here proves every query carries the user's own id;
// RLS itself is verified by the host browser checklist (rows per user).
// Run: node --test src/lib/repo.test.ts (from apps/web). No network, no keys.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { newRun } from '@mizzou/core';
import { memoryRepo, supabaseRepo, type DbClient, type DbQuery, type DbResult, type Repo } from './repo.ts';

type Row = Record<string, unknown>;

interface Filter {
  col: string;
  op: 'eq' | 'is' | 'gte';
  val: unknown;
}

let fakeSeq = 0;

class FakeQuery implements DbQuery<Row[]> {
  private filters: Filter[] = [];
  private ordering: { col: string; ascending: boolean } | null = null;
  private limitN: number | null = null;
  private wantSingle = false;
  private tables: Record<string, Row[]>;
  private table: string;
  private kind: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  private payload: unknown;
  private upsertConflict: string | undefined;

  constructor(
    tables: Record<string, Row[]>,
    table: string,
    kind: 'select' | 'insert' | 'update' | 'upsert' | 'delete',
    payload?: unknown,
    upsertConflict?: string,
  ) {
    this.tables = tables;
    this.table = table;
    this.kind = kind;
    this.payload = payload;
    this.upsertConflict = upsertConflict;
  }

  private spawn(): FakeQuery {
    const q = new FakeQuery(this.tables, this.table, this.kind, this.payload, this.upsertConflict);
    q.filters = [...this.filters];
    q.ordering = this.ordering;
    q.limitN = this.limitN;
    q.wantSingle = this.wantSingle;
    return q;
  }

  eq(col: string, val: unknown): DbQuery<Row[]> {
    const q = this.spawn();
    q.filters.push({ col, op: 'eq', val });
    return q;
  }

  is(col: string, val: null): DbQuery<Row[]> {
    const q = this.spawn();
    q.filters.push({ col, op: 'is', val });
    return q;
  }

  gte(col: string, val: string): DbQuery<Row[]> {
    const q = this.spawn();
    q.filters.push({ col, op: 'gte', val });
    return q;
  }

  order(col: string, opts?: { ascending?: boolean }): DbQuery<Row[]> {
    const q = this.spawn();
    q.ordering = { col, ascending: opts?.ascending !== false };
    return q;
  }

  limit(n: number): DbQuery<Row[]> {
    const q = this.spawn();
    q.limitN = n;
    return q;
  }

  select(): DbQuery<Row[]> {
    return this.spawn();
  }

  delete(): DbQuery<Row[]> {
    const q = this.spawn();
    (q as { kind: string }).kind = 'delete';
    return q;
  }

  async single(): Promise<DbResult<unknown>> {
    const res = this.run();
    if (!res.data || res.data.length === 0) return { data: null, error: { message: '0 rows' } };
    return { data: res.data[0], error: null };
  }

  then<TResult1 = DbResult<Row[]>, TResult2 = never>(
    onfulfilled?: ((value: DbResult<Row[]>) => TResult1 | PromiseLike<TResult1>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled as (v: DbResult<Row[]>) => TResult1);
  }

  private rows(): Row[] {
    let rows = [...(this.tables[this.table] ?? [])];
    for (const f of this.filters) {
      if (f.op === 'eq') rows = rows.filter((r) => r[f.col] === f.val);
      else if (f.op === 'is') rows = rows.filter((r) => r[f.col] == null);
      else rows = rows.filter((r) => typeof r[f.col] === 'string' && (r[f.col] as string) >= (f.val as string));
    }
    if (this.ordering) {
      const { col, ascending } = this.ordering;
      rows.sort((a, b) => {
        const av = (a[col] ?? '') as string;
        const bv = (b[col] ?? '') as string;
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * (ascending ? 1 : -1);
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    return rows;
  }

  private run(): DbResult<Row[]> {
    if (this.kind === 'insert') {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      const table = (this.tables[this.table] ??= []);
      const out: Row[] = [];
      for (const row of rows) {
        const copy: Row = { ...row };
        if (copy['id'] === undefined) copy['id'] = `fake-${(fakeSeq += 1)}`;
        if (copy['created_at'] === undefined) copy['created_at'] = new Date().toISOString();
        table.push(copy);
        out.push(copy);
      }
      return { data: out, error: null };
    }
    if (this.kind === 'update') {
      const patch = (this.payload ?? {}) as Row;
      const out: Row[] = [];
      for (const row of this.rows()) {
        Object.assign(row, patch);
        out.push(row);
      }
      return { data: out, error: null };
    }
    if (this.kind === 'upsert') {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      const table = (this.tables[this.table] ??= []);
      const keys = (this.upsertConflict ?? 'id').split(',').map((s) => s.trim());
      const out: Row[] = [];
      for (const row of rows) {
        const existing = table.find((r) => keys.every((k) => r[k] === row[k]));
        if (existing) {
          Object.assign(existing, row);
          out.push(existing);
        } else {
          const copy: Row = { ...row };
          if (copy['created_at'] === undefined) copy['created_at'] = new Date().toISOString();
          table.push(copy);
          out.push(copy);
        }
      }
      return { data: out, error: null };
    }
    if (this.kind === 'delete') {
      const table = (this.tables[this.table] ??= []);
      const condemned = new Set(this.rows());
      const remaining = table.filter((r) => !condemned.has(r));
      this.tables[this.table] = remaining;
      return { data: [...condemned], error: null };
    }
    return { data: this.rows(), error: null };
  }
}

function fakeDb(seed: Record<string, Row[]> = {}): { client: DbClient; tables: Record<string, Row[]> } {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, [...v]]));
  const client: DbClient = {
    from: (table) => ({
      select: () => new FakeQuery(tables, table, 'select'),
      insert: (rows) => new FakeQuery(tables, table, 'insert', rows),
      update: (patch) => new FakeQuery(tables, table, 'update', patch),
      upsert: (rows, opts) => new FakeQuery(tables, table, 'upsert', rows, opts?.onConflict),
      delete: () => new FakeQuery(tables, table, 'delete'),
    }),
  };
  return { client, tables };
}

function repoWithSeed(seed: Record<string, Row[]> = {}): { repo: Repo; tables: Record<string, Row[]> } {
  const { client, tables } = fakeDb(seed);
  return { repo: supabaseRepo(client), tables };
}

describe('supabase repo behind the interface', () => {
  it('round-trips a run with gate, decisions and usage', async () => {
    const { repo } = repoWithSeed();
    const run = newRun('11111111-1111-4111-8111-111111111111', 'user-a', 'chat-1');
    run.status = 'needs_approval';
    run.pendingGate = { gate: 'G1', what: 'Is this the one?', evidence: { origin: 'chat', card: {} }, options: null };
    run.decisions.push({ gate: 'G1', decision: { confirmed: true }, opId: 'op-1' });
    run.turnCount = 3;
    run.usageUsd = 0.042;
    await repo.runs.save(run);
    const loaded = await repo.runs.load(run.id);
    assert.ok(loaded);
    assert.equal(loaded.status, 'needs_approval');
    assert.deepEqual(loaded.pendingGate, run.pendingGate);
    assert.deepEqual(loaded.decisions, run.decisions);
    assert.equal(loaded.turnCount, 3);
    assert.equal(loaded.usageUsd, 0.042);
    assert.equal(loaded.userId, 'user-a');
  });

  it('returns null for an unknown run id', async () => {
    const { repo } = repoWithSeed();
    assert.equal(await repo.runs.load('22222222-2222-4222-8222-222222222222'), null);
  });

  it('snapshots today’s usage spend per user and globally', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const mk = (user: string, cost: number, day: string) => ({ user_id: user, cost_usd: cost, created_at: `${day}T10:00:00.000Z` });
    const { repo } = repoWithSeed({
      usage: [mk('user-a', 2, today), mk('user-a', 3, today), mk('user-a', 50, yesterday), mk('user-b', 1, today)],
    });
    assert.deepEqual(await repo.usage.snapshot('user-a'), { userSpend: 5, globalSpend: 6 });
    assert.deepEqual(await repo.usage.snapshot('user-b'), { userSpend: 1, globalSpend: 6 });
  });

  it('flushes completed calls into the usage table', async () => {
    const { repo, tables } = repoWithSeed();
    await repo.usage.flush(
      [{ userId: 'user-a', model: 'muse-spark-1.3', promptTokens: 100, completionTokens: 10, costUsd: 0.004, at: new Date().toISOString() }],
      'run-1',
    );
    assert.equal(tables['usage'].length, 1);
    assert.equal(tables['usage'][0]?.['user_id'], 'user-a');
    assert.equal(tables['usage'][0]?.['run_id'], 'run-1');
    assert.equal(tables['usage'][0]?.['cost_usd'], 0.004);
    // Empty flush writes nothing.
    await repo.usage.flush([]);
    assert.equal(tables['usage'].length, 1);
  });

  it('keeps reminders per user and maps sub to status_line', async () => {
    const { repo } = repoWithSeed();
    const a = await repo.reminders.create('user-a', { title: 'Passport', sub: 'Not finished', pill: 'in 3d', dueAt: '2026-11-05T00:00:00.000Z' });
    assert.equal(a.sub, 'Not finished');
    await repo.reminders.create('user-b', { title: 'Other', sub: 'x', pill: 'Soon' });
    const listed = await repo.reminders.list('user-a');
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.title, 'Passport');
    assert.equal(listed[0]?.dueAt, '2026-11-05T00:00:00.000Z');
  });

  it('chats support ensure, rename, clear with undo, and isolation', async () => {
    const { repo } = repoWithSeed();
    await repo.chats.ensure('chat-1', 'user-a', 'First chat');
    await repo.chats.ensure('chat-1', 'user-a', 'First chat');
    await repo.chats.ensure('chat-9', 'user-b', 'Other chat');
    assert.equal((await repo.chats.list('user-a')).length, 1);
    await repo.chats.rename('chat-1', 'user-a', 'Renamed');
    assert.equal((await repo.chats.list('user-a'))[0]?.title, 'Renamed');
    const removed = await repo.chats.clear('user-a');
    assert.equal(removed.length, 1);
    assert.equal(await repo.chats.list('user-a').then((r) => r.length), 0);
    assert.equal((await repo.chats.list('user-b')).length, 1);
    await repo.chats.restore('user-a', removed);
    assert.equal((await repo.chats.list('user-a')).length, 1);
  });

  it('clears only the requesting user’s reminders', async () => {
    const mk = (user: string, n: number) => ({ user_id: user, title: `t${n}`, status_line: 's', pill: 'p' });
    const { repo, tables } = repoWithSeed({ reminders: [mk('user-a', 1), mk('user-a', 2), mk('user-b', 3)] });
    assert.equal(await repo.reminders.clear('user-a'), 2);
    assert.deepEqual((tables['reminders'] ?? []).map((r) => r['user_id']), ['user-b']);
    assert.equal(await repo.reminders.clear('user-a'), 0);
  });

  it('the in-memory repo honors the same contract', async () => {
    const mem = memoryRepo();
    const run = newRun('33333333-3333-4333-8333-333333333333', 'user-c', null);
    await mem.runs.save(run);
    assert.ok(await mem.runs.load(run.id));
    await mem.chats.ensure('c1', 'user-c', 't');
    assert.equal((await mem.chats.list('user-c')).length, 1);
    await mem.usage.flush(
      [{ userId: 'user-c', model: 'm', promptTokens: 10, completionTokens: 1, costUsd: 0.001, at: new Date().toISOString() }],
      '33333333-3333-4333-8333-333333333333',
    );
    assert.deepEqual(await mem.usage.snapshot('user-c'), { userSpend: 0.001, globalSpend: 0.001 });
  });
});
