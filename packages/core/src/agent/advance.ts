import type { RunEvent } from '../schemas/events.js';
import type { GateDecision, PendingGate, RunRecord } from './types.js';
import type { RunStore } from './store.js';

// Turn loop skeleton (PROMPT.md 5.3). Tool handlers arrive in M4; this file
// owns the mechanics: turn cap, platform-time guard, gate halting,
// idempotent resume, and persist-after-every-step.

// Section 5.1 hard cap.
export const DEFAULT_MAX_TURNS = 12;

/**
 * Real platform budget in ms: Vercel Hobby maxDuration is 60s, matching the
 * chat route's `export const maxDuration = 60`. The loop stops at 80% of
 * this so the client can resume. Route handlers with their own maxDuration
 * MUST pass deadlineMs explicitly — never rely on a test value here.
 */
export const PLATFORM_DEFAULT_DEADLINE_MS = 60_000;

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
  /**
   * Platform budget in ms; the loop stops at 80% so the client can resume.
   * Defaults to PLATFORM_DEFAULT_DEADLINE_MS (the real 60s ceiling, not a
   * test value). Routes with their own maxDuration pass it explicitly.
   */
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
  const timeBudget = Math.floor((opts.deadlineMs ?? PLATFORM_DEFAULT_DEADLINE_MS) * 0.8);
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

export interface ResumeResult {
  run: RunRecord;
  /** True when the opId was already applied: nothing re-ran. */
  duplicate: boolean;
  needsResume: boolean;
  events: RunEvent[];
}

/**
 * The POST /api/runs/[runId]/resume composition: record the gate decision,
 * then continue the run when the decision was fresh. A repeated opId replays
 * the stored row and returns no events without running the step again.
 */
export async function resumeRun(
  runId: string,
  store: RunStore,
  decision: GateDecision,
  step: StepFn,
  opts: AdvanceOptions = {},
): Promise<ResumeResult> {
  const { run, duplicate } = await recordDecision(runId, store, decision);
  if (duplicate) return { run, duplicate: true, needsResume: false, events: [] };
  const events: RunEvent[] = [];
  const { run: advanced, needsResume } = await advance(runId, store, step, {
    ...opts,
    onEvent: (event) => {
      events.push(event);
      opts.onEvent?.(event);
    },
  });
  return { run: advanced, duplicate: false, needsResume, events };
}

export interface ContinueResult {
  run: RunRecord;
  /** True when nothing stepped: the run is not running or the opId was seen. */
  duplicate: boolean;
  needsResume: boolean;
  events: RunEvent[];
}

/**
 * Continue a running run without a new gate decision (time-slice resume).
 * The opId is still an idempotency key: repeating it replays the stored row
 * without stepping again. Tracked in state.continueOpIds, next to decisions.
 */
export async function continueRun(
  runId: string,
  store: RunStore,
  opId: string,
  step: StepFn,
  opts: AdvanceOptions = {},
): Promise<ContinueResult> {
  const run = await store.load(runId);
  if (!run) throw new Error(`unknown run: ${runId}`);
  if (run.status !== 'running') return { run, duplicate: true, needsResume: false, events: [] };
  const state = run.state as Record<string, unknown>;
  const seen = Array.isArray(state['continueOpIds'])
    ? (state['continueOpIds'] as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  if (seen.includes(opId)) {
    const fresh = await store.load(runId);
    return { run: fresh ?? run, duplicate: true, needsResume: false, events: [] };
  }
  seen.push(opId);
  state['continueOpIds'] = seen;
  await store.save(run);
  const events: RunEvent[] = [];
  const { run: advanced, needsResume } = await advance(runId, store, step, {
    ...opts,
    onEvent: (event) => {
      events.push(event);
      opts.onEvent?.(event);
    },
  });
  return { run: advanced, duplicate: false, needsResume, events };
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
