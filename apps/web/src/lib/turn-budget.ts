// Per-turn wall-clock slice for the chat and resume routes. Vercel Hobby
// kills a function at 60 s, and a model or tool call that starts near the
// end of the slice can still overrun it, so the slice stays well under
// half the ceiling. Slow single calls stay bounded separately by the
// per-call timeouts (15 s fetch, 20 s reader, 30 s model).

/** Default slice in ms when MIZZOU_TURN_BUDGET_MS is unset or unusable. */
export const DEFAULT_TURN_BUDGET_MS = 28_000;

/** Smallest and largest slices the env var may request. */
export const MIN_TURN_BUDGET_MS = 5_000;
export const MAX_TURN_BUDGET_MS = 55_000;

/** Turn slice in ms from MIZZOU_TURN_BUDGET_MS, clamped to the safe range. */
export function turnBudgetMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.MIZZOU_TURN_BUDGET_MS;
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  if (Number.isFinite(n)) {
    return Math.min(MAX_TURN_BUDGET_MS, Math.max(MIN_TURN_BUDGET_MS, Math.floor(n)));
  }
  return DEFAULT_TURN_BUDGET_MS;
}
