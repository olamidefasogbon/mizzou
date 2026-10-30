// Run persistence behind one interface (Part A steps 3-4). Routes talk to
// a RunLedger; tests use the in-memory ledger, production uses the file
// ledger until step 4 swaps in Supabase (RLS through the user session).
// Server-only: route handlers and server actions.

import 'server-only';

import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileRunStore, newRun, type RunRecord } from '@mizzou/core';

export interface RunLedger {
  load(id: string): Promise<RunRecord | null>;
  save(run: RunRecord): Promise<void>;
  /** Runs this user started today (UTC). Guests are capped on this number. */
  countStartedToday(userId: string): Promise<number>;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function runsDir(): string {
  return process.env.MIZZOU_DATA_DIR ?? join(tmpdir(), 'mizzou', 'runs');
}

/** File-backed ledger: the FileRunStore plus a day-count over its rows. */
export function fileRunLedger(dir: string = runsDir()): RunLedger {
  const store = new FileRunStore(dir);
  return {
    load: (id) => store.load(id),
    save: (run) => store.save(run),
    countStartedToday: async (userId) => {
      let files: string[] = [];
      try {
        files = await readdir(dir);
      } catch {
        return 0;
      }
      let count = 0;
      for (const file of files) {
        try {
          const parsed: unknown = JSON.parse(await readFile(join(dir, file), 'utf-8'));
          if (
            typeof parsed === 'object' &&
            parsed !== null &&
            (parsed as { userId?: unknown }).userId === userId &&
            typeof (parsed as { updatedAt?: unknown }).updatedAt === 'string' &&
            ((parsed as { updatedAt: string }).updatedAt.slice(0, 10) === todayUtc())
          ) {
            count += 1;
          }
        } catch {
          // A half-written row must not break the cap check.
        }
      }
      return count;
    },
  };
}

/** In-memory ledger for tests. Same counting rule as the file ledger. */
export function memoryRunLedger(): RunLedger & { seed(run: RunRecord): void } {
  const rows = new Map<string, RunRecord>();
  return {
    load: async (id) => rows.get(id) ?? null,
    save: async (run) => {
      rows.set(run.id, JSON.parse(JSON.stringify(run)) as RunRecord);
    },
    countStartedToday: async (userId) =>
      [...rows.values()].filter(
        (r) => r.userId === userId && typeof r.updatedAt === 'string' && r.updatedAt.slice(0, 10) === todayUtc(),
      ).length,
    seed: (run) => {
      rows.set(run.id, run);
    },
  };
}

export { newRun };
export type { RunRecord };
