import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileRunStore, createDeepScanStep, resumeRun, type Gate } from '@mizzou/core';

export const maxDuration = 60;

const GATES: ReadonlySet<string> = new Set(['G1', 'G2', 'G3', 'G4', 'G5']);

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

/**
 * POST /api/runs/[runId]/resume — record a gate decision and continue the run.
 * Body: { gate: 'G1'|'G2'|'G3'|'G4'|'G5', decision: unknown, opId: string }.
 * The opId is an idempotency key: repeating it replays the stored row with
 * { duplicate: true } and never re-runs the step. Fresh decisions continue
 * the deep scan inside this route's 60s budget (the loop stops at 80%).
 */
export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }): Promise<Response> {
  const { runId } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('Expected a JSON body.');
  }
  const gate = (body as { gate?: unknown }).gate;
  const decision = (body as { decision?: unknown }).decision;
  const opId = (body as { opId?: unknown }).opId;
  if (typeof gate !== 'string' || !GATES.has(gate)) {
    return badRequest('Expected gate to be one of G1, G2, G3, G4, G5.');
  }
  if (!('decision' in (body as Record<string, unknown>))) {
    return badRequest('Expected a decision value.');
  }
  if (typeof opId !== 'string' || opId.length === 0 || opId.length > 128) {
    return badRequest('Expected opId to be a non-empty string up to 128 characters.');
  }
  const store = new FileRunStore(join(process.env.MIZZOU_DATA_DIR ?? join(tmpdir(), 'mizzou'), 'runs'));
  try {
    const { run, duplicate, needsResume, events } = await resumeRun(
      runId,
      store,
      { gate: gate as Gate, decision, opId },
      createDeepScanStep(),
      { deadlineMs: 60_000 },
    );
    return Response.json({
      runId,
      duplicate,
      status: run.status,
      pendingGate: run.pendingGate,
      needsResume,
      events,
      result: (run.state as { result?: unknown }).result ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Resume failed.';
    if (message.startsWith('unknown run:')) {
      return Response.json({ error: 'Unknown run.' }, { status: 404 });
    }
    if (message.startsWith('no open ')) {
      return Response.json({ error: message }, { status: 409 });
    }
    if (message.startsWith('unsafe run id:')) {
      return badRequest('Invalid run id.');
    }
    return Response.json({ error: 'Resume failed.' }, { status: 500 });
  }
}
