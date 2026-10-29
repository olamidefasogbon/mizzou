import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { advance, recordDecision, resumeRun } from './advance.js';
import { FileRunStore } from './store.js';
import { newRun } from './types.js';

// Sandbox-safe scratch: the OS temp dir is not writable here, so tests use
// a repo-local prefix and always clean up (see cleanup() in finally blocks).
const HERE = dirname(fileURLToPath(import.meta.url));

async function freshStore(): Promise<{ store: FileRunStore; dir: string }> {
  const dir = await mkdtemp(join(HERE, '.tmp-agent-'));
  return { store: new FileRunStore(dir), dir };
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

describe('advance', () => {
  it('finishes a run and persists the result', async () => {
    const { store, dir } = await freshStore();
    try {
      const events: unknown[] = [];
      await store.save(newRun('r1'));
      const { run, needsResume } = await advance('r1', store, async () => ({
        events: [{ t: 'done', runId: 'r1' }],
        finished: { ok: true },
      }), { onEvent: (e) => events.push(e) });
      expect(run.status).toBe('done');
      expect(run.state.result).toEqual({ ok: true });
      expect(run.turnCount).toBe(1);
      expect(needsResume).toBe(false);
      expect(events).toHaveLength(1);
      const reloaded = await store.load('r1');
      expect(reloaded?.status).toBe('done');
    } finally {
      await cleanup(dir);
    }
  });

  it('halts at a gate and resumes only through a matching decision', async () => {
    const { store, dir } = await freshStore();
    try {
      await store.save(newRun('r2'));
      const gate = { gate: 'G1' as const, what: 'Is this the program?', evidence: null, options: null };
      const halted = await advance('r2', store, async () => ({ events: [], gate }));
      expect(halted.run.status).toBe('needs_approval');
      expect(halted.needsResume).toBe(false);

      // A halted run does not advance until the gate is decided.
      let stepped = false;
      await advance('r2', store, async () => { stepped = true; return { events: [] }; });
      expect(stepped).toBe(false);

      await expect(
        recordDecision('r2', store, { gate: 'G3', decision: {}, opId: 'op-1' }),
      ).rejects.toThrow(/no open G3 gate/);
      const first = await recordDecision('r2', store, { gate: 'G1', decision: 'yes', opId: 'op-1' });
      expect(first.duplicate).toBe(false);
      expect(first.run.status).toBe('running');
      const replay = await recordDecision('r2', store, { gate: 'G1', decision: 'yes', opId: 'op-1' });
      expect(replay.duplicate).toBe(true);
      expect(replay.run.decisions).toHaveLength(1);
    } finally {
      await cleanup(dir);
    }
  });

  it('stops at the turn cap and asks for resume', async () => {
    const { store, dir } = await freshStore();
    try {
      await store.save(newRun('r3'));
      const { run, needsResume } = await advance('r3', store, async () => ({ events: [] }), { maxTurns: 3 });
      expect(run.turnCount).toBe(3);
      expect(run.status).toBe('running');
      expect(needsResume).toBe(true);
    } finally {
      await cleanup(dir);
    }
  });

  it('stops at 80% of the platform budget without stepping', async () => {
    const { store, dir } = await freshStore();
    try {
      await store.save(newRun('r4'));
      let t = 1000;
      let stepped = false;
      const { run, needsResume } = await advance(
        'r4', store,
        async () => { stepped = true; return { events: [] }; },
        { deadlineMs: 1000, now: () => (t += 900) },
      );
      expect(stepped).toBe(false);
      expect(run.status).toBe('running');
      expect(needsResume).toBe(true);
    } finally {
      await cleanup(dir);
    }
  });

  it('resumes a decided run exactly once per opId', async () => {
    const { store, dir } = await freshStore();
    try {
      await store.save(newRun('r9'));
      const gate = { gate: 'G2' as const, what: 'Which date?', evidence: null, options: null };
      await advance('r9', store, async () => ({ events: [], gate }));
      let steps = 0;
      const step = async () => {
        steps += 1;
        return { events: [{ t: 'done' as const, runId: 'r9' }], finished: { ok: 1 } };
      };
      const first = await resumeRun('r9', store, { gate: 'G2', decision: 'a', opId: 'op-9' }, step);
      expect(first.duplicate).toBe(false);
      expect(first.run.status).toBe('done');
      expect(first.events).toHaveLength(1);
      expect(steps).toBe(1);
      const replay = await resumeRun('r9', store, { gate: 'G2', decision: 'a', opId: 'op-9' }, step);
      expect(replay.duplicate).toBe(true);
      expect(replay.events).toEqual([]);
      expect(steps).toBe(1);
      expect(replay.run.decisions).toHaveLength(1);
    } finally {
      await cleanup(dir);
    }
  });

  it('leaves finished runs alone and rejects unknown ids', async () => {
    const { store, dir } = await freshStore();
    try {
      const done = { ...newRun('r5'), status: 'done' as const };
      await store.save(done);
      let stepped = false;
      const { needsResume } = await advance('r5', store, async () => { stepped = true; return { events: [] }; });
      expect(stepped).toBe(false);
      expect(needsResume).toBe(false);
      await expect(advance('nope', store, async () => ({ events: [] }))).rejects.toThrow(/unknown run/);
    } finally {
      await cleanup(dir);
    }
  });
});

describe('FileRunStore', () => {
  it('round-trips a run and returns null for missing ids', async () => {
    const { store, dir } = await freshStore();
    try {
      expect(await store.load('missing')).toBeNull();
      const run = newRun('r6', 'u1', 'c1');
      await store.save(run);
      const raw = JSON.parse(await readFile(join(dir, 'r6.json'), 'utf-8')) as { id: string };
      expect(raw.id).toBe('r6');
      expect((await store.load('r6'))?.userId).toBe('u1');
    } finally {
      await cleanup(dir);
    }
  });

  it('rejects path-traversal run ids', async () => {
    const { store, dir } = await freshStore();
    try {
      await expect(store.save({ ...newRun('../evil'), id: '../evil' })).rejects.toThrow(/unsafe run id/);
    } finally {
      await cleanup(dir);
    }
  });
});
