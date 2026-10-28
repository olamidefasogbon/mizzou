import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunRecord } from './types.js';

// Persistence seam for runs (PROMPT.md 5.3). The web app and the eval CLI
// share this interface; only the implementation swaps at Supabase time.

export interface RunStore {
  load(runId: string): Promise<RunRecord | null>;
  save(run: RunRecord): Promise<void>;
}

function safeFileName(runId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(runId)) throw new Error(`unsafe run id: ${runId}`);
  return `${runId}.json`;
}

function isRunRecord(value: unknown): value is RunRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.status === 'string' &&
    ['running', 'needs_approval', 'done', 'failed'].includes(r.status) &&
    typeof r.turnCount === 'number' &&
    Array.isArray(r.messages) &&
    typeof r.state === 'object'
  );
}

/** JSON files under a directory; atomic via tmp-file rename. */
export class FileRunStore implements RunStore {
  constructor(private readonly dir: string) {}

  private path(runId: string): string {
    return join(this.dir, safeFileName(runId));
  }

  async load(runId: string): Promise<RunRecord | null> {
    let text: string;
    try {
      text = await readFile(this.path(runId), 'utf-8');
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'ENOENT') return null;
      throw err;
    }
    const parsed: unknown = JSON.parse(text);
    return isRunRecord(parsed) ? parsed : null;
  }

  async save(run: RunRecord): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.path(run.id)}.tmp-${process.pid}`;
    await writeFile(tmp, JSON.stringify({ ...run, updatedAt: new Date().toISOString() }), 'utf-8');
    await rename(tmp, this.path(run.id));
  }
}
