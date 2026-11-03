// How long one request may keep starting new work. The platform ends a
// request at 60 seconds, and one more page read can take 20 or more, so new
// rounds and tool calls stop at 28 seconds. The turn then saves its place and
// the client continues in a fresh request (see the `continue` event).
export const DEFAULT_TURN_BUDGET_MS = 28_000;

export function turnBudgetMs(): number {
  const raw = Number(process.env['MIZZOU_TURN_BUDGET_MS']);
  if (!Number.isFinite(raw)) return DEFAULT_TURN_BUDGET_MS;
  return Math.min(50_000, Math.max(8_000, Math.round(raw)));
}
