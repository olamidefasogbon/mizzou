// Run state for the resumable agent loop (PROMPT.md section 5.3).
// File-backed until Supabase is wired; the store interface stays the same.

export type RunStatus = 'running' | 'needs_approval' | 'done' | 'failed';

export type Gate = 'G1' | 'G2' | 'G3' | 'G4' | 'G5';

export interface PendingGate {
  gate: Gate;
  what: string;
  evidence: unknown;
  options: unknown;
}

export interface GateDecision {
  gate: Gate;
  decision: unknown;
  /** Client-generated idempotency key: a repeated opId replays, never re-applies. */
  opId: string;
}

export interface RunRecord {
  id: string;
  userId: string | null;
  chatId: string | null;
  status: RunStatus;
  turnCount: number;
  /** Full model message history (server-managed replay may not exist). */
  messages: unknown[];
  /** Typed working memory: confirmed program, pages, extraction, fit, plan, drafts. */
  state: Record<string, unknown>;
  pendingGate: PendingGate | null;
  decisions: GateDecision[];
  usageUsd: number;
  updatedAt: string;
}

export function newRun(id: string, userId: string | null = null, chatId: string | null = null): RunRecord {
  return {
    id,
    userId,
    chatId,
    status: 'running',
    turnCount: 0,
    messages: [],
    state: {},
    pendingGate: null,
    decisions: [],
    usageUsd: 0,
    updatedAt: new Date().toISOString(),
  };
}
