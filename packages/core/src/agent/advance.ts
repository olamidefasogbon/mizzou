import type { RunEvent } from '../schemas/events.js';
import type { GateDecision, PendingGate, RunRecord } from './types.js';
import type { RunStore } from './store.js';

// Turn loop skeleton (PROMPT.md 5.3). Tool handlers arrive in M4; this file
// owns the mechanics: turn cap, platform-time guard, gate halting,
// idempotent resume, and persist-after-every-step.

// Section 5.1 hard cap.
export const DEFAULT_MAX_TURNS = 12;

export interface StepOutcome {
  events: RunEvent[];
  /** Set to finish the run; stored at state.result. */
  finished?: unknown;
  /** Set to halt the run at a human gate. */
  gate?: PendingGate;
}

/** One orchestrator turn. M4 implements tool calling here. */
export type StepFn = (run: RunRecord) => Promise<StepOutcome>;

export interface AdvanceOptions {
  maxTurns?: number;
  /** Platform budget in ms; the loop stops at 80% so the client can resume. */
  deadlineMs?: number;
  now?: () => number;
  onEvent?: (event: RunEvent) => void;
}

export interface AdvanceResult {
  run: RunRecord;
  /** True when the run is still live but this pass must stop (cap or time). */
  needsResume: boolean;
}

export async function advance(
  runId: string,
  store: RunStore,
  step: StepFn,
  opts: AdvanceOptions = {},
): Promise<AdvanceResult> {
  const now = opts.now ?? Date.now;
  const startedAt = now();
  const timeBudget = Math.floor((opts.deadlineMs ?? 60_000) * 0.8);
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;

  const run = await store.load(runId);
  if (!run) throw new Error(`unknown run: ${runId}`);
  if (run.status === 'done' || run.status === 'failed') return { run, needsResume: false };
  if (run.pendingGate) return { run, needsResume: false }; // halted: resume via recordDecision

  while (run.turnCount < maxTurns) {
    if (now() - startedAt >= timeBudget) break;
    const outcome = await step(run);
    run.turnCount += 1;
    for (const event of outcome.events) opts.onEvent?.(event);
    if (outcome.gate) {
      run.pendingGate = outcome.gate;
      run.status = 'needs_approval';
      await store.save(run);
      return { run, needsResume: false };
    }
    if (outcome.finished !== undefined) {
      run.status = 'done';
      run.state = { ...run.state, result: outcome.finished };
      await store.save(run);
      return { run, needsResume: false };
    }
    await store.save(run); // persist after every step, so a timeout never kills work
  }
  await store.save(run);
  return { run, needsResume: run.status === 'running' };
}

/**
 * Continue a halted run after a gate decision (POST /api/runs/[runId]/resume).
 * A repeated opId replays the stored row without applying anything twice.
 */
export async function recordDecision(
  runId: string,
  store: RunStore,
  decision: GateDecision,
): Promise<{ run: RunRecord; duplicate: boolean }> {
  const run = await store.load(runId);
  if (!run) throw new Error(`unknown run: ${runId}`);
  if (run.decisions.some((d) => d.opId === decision.opId)) return { run, duplicate: true };
  if (!run.pendingGate || run.pendingGate.gate !== decision.gate) {
    throw new Error(`no open ${decision.gate} gate on run ${runId}`);
  }
  run.decisions.push(decision);
  run.pendingGate = null;
  run.status = 'running';
  run.messages.push({ role: 'tool_result', gate: decision.gate, decision: decision.decision });
  await store.save(run);
  return { run, duplicate: false };
}
