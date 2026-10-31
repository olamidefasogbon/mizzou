import {
  BudgetExceededError,
  BudgetGuard,
  DEFAULT_MAX_TURNS,
  SAY_STUCK,
  budgetFriendlyMessage,
  continueRun,
  createDeepScanStep,
  encodeSseEvent,
  limitsFromEnv,
  recordDecision,
  resumeRun,
  runConversationTurn,
  type Gate,
  type RunEvent,
} from '@mizzou/core';
import { AuthRequiredError, resolveUser } from '@/lib/auth';
import { logServerError, userErrorWithRef } from '@/lib/errors';
import { adaptDb, repo } from '@/lib/repo';
import { abuseLimitsFromEnv, checkHitRate, clientIp, logCapRefusal, supabaseCounterStore } from '@/lib/caps';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { RequestUsageStore } from '@/lib/usage';

// Vercel Hobby maximum is 60s (PROMPT.md 9.2 says platform maximum —
// confirm against the Vercel plan at deploy; raise this when the plan grows).
export const maxDuration = 60;

const GATES: ReadonlySet<string> = new Set(['G1', 'G2', 'G3', 'G4', 'G5']);

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

/**
 * POST /api/runs/[runId]/resume — continue the agent over server-sent events.
 * Body always carries { opId } (idempotency key) and, when answering a gate,
 * { gate, decision }. A repeated opId replays without stepping again.
 * Terminal frames: needs_approval on a gate, continue when only time ran
 * out (the client re-posts with a fresh opId), done with the run id.
 */
export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }): Promise<Response> {
  const { runId } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('Expected a JSON body.');
  }
  const record = body as Record<string, unknown>;
  const gate = record['gate'];
  const decision = record['decision'];
  const opId = record['opId'];
  if (typeof opId !== 'string' || opId.length === 0 || opId.length > 128) {
    return badRequest('Expected opId to be a non-empty string up to 128 characters.');
  }
  const answering = gate !== undefined || 'decision' in record;
  if (answering) {
    if (typeof gate !== 'string' || !GATES.has(gate)) {
      return badRequest('Expected gate to be one of G1, G2, G3, G4, G5.');
    }
    if (!('decision' in record)) {
      return badRequest('Expected a decision value.');
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (e: RunEvent): void => {
        controller.enqueue(enc.encode(encodeSseEvent(e)));
      };
      const fail = (friendly: string, link?: string): void => {
        send({ t: 'error', friendly, link });
        send({ t: 'done', runId });
        controller.close();
      };
      try {
        let userId: string;
        try {
          ({ userId } = await resolveUser());
        } catch (err) {
          if (err instanceof AuthRequiredError) {
            fail('Give it a minute and try again.');
            return;
          }
          throw err;
        }
        const db = await repo();
        const store = db.runs;
        const hit = await checkHitRate(supabaseCounterStore(adaptDb(supabaseAdmin())), clientIp(req));
        if (!hit.ok) {
          logCapRefusal(hit.detail);
          fail(hit.message);
          return;
        }
        const snapshot = await db.usage.snapshot(userId);
        const usageStore = new RequestUsageStore(snapshot.userSpend, snapshot.globalSpend);
        const budgetGuard = new BudgetGuard(usageStore, limitsFromEnv());
        const step = createDeepScanStep({ budgetGuard, maxPages: abuseLimitsFromEnv().maxPagesPerRun });
        try {
          const existing = await store.load(runId);
          const origin =
            existing && existing.pendingGate && typeof existing.pendingGate.evidence === 'object' && existing.pendingGate.evidence !== null
              ? (existing.pendingGate.evidence as { origin?: unknown }).origin
              : undefined;
          let run;
          if (answering && origin === 'chat') {
            // Conversation-run gate (AGENT_BRAIN.md): record the decision,
            // then continue with a model turn — the pendingGate (if any) is
            // set by the orchestrator, not by the deep-scan loop.
            const recorded = await recordDecision(runId, store, { gate: gate as Gate, decision, opId });
            run = recorded.run;
            if (!recorded.duplicate) {
              await runConversationTurn({
                run,
                save: (r) => store.save(r),
                userText: `The user answered ${String(gate)}: ${JSON.stringify(decision)}`,
                userId: run.userId ?? userId,
                budgetGuard,
                send,
                listReminders: async () =>
                  (await db.reminders.list(userId)).map((r) => ({
                    id: r.id,
                    text: r.sub ? `${r.title} — ${r.sub}` : r.title,
                    dueAt: r.dueAt,
                  })),
              });
            }
          } else {
            const outcome = answering
              ? await resumeRun(
                  runId,
                  store,
                  { gate: gate as Gate, decision, opId },
                  step,
                  { maxTurns: DEFAULT_MAX_TURNS, onEvent: send },
                )
              : await continueRun(runId, store, opId, step, { maxTurns: DEFAULT_MAX_TURNS, onEvent: send });
            run = outcome.run;
            if (outcome.needsResume && run.status === 'running') {
              if (run.turnCount < DEFAULT_MAX_TURNS) {
                send({ t: 'continue', runId });
              } else {
                fail(SAY_STUCK);
                return;
              }
            }
          }
          if (run.pendingGate) {
            const evidence = run.pendingGate.evidence as { card?: unknown } | Record<string, unknown> | null | undefined;
            const base =
              evidence && typeof evidence === 'object' && 'card' in evidence && evidence.card !== null && typeof evidence.card === 'object'
                ? (evidence.card as Record<string, unknown>)
                : ((evidence as Record<string, unknown> | null | undefined) ?? {});
            send({
              t: 'needs_approval',
              gate: run.pendingGate.gate,
              card: { ...base, what: run.pendingGate.what },
            });
          }
          send({ t: 'done', runId });
          controller.close();
        } finally {
          try {
            await db.usage.flush(usageStore.pending(), runId);
          } catch (flushErr) {
            logServerError('resume-usage', flushErr);
          }
        }
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          console.warn(`[mizzou:budget] refusal scope=${err.scope} amount=${err.amount} limit=${err.limit}`);
          fail(budgetFriendlyMessage(err.scope));
          return;
        }
        if (err instanceof AuthRequiredError) {
          fail('Give it a minute and try again.');
          return;
        }
        if (err instanceof Error) {
          const message = err.message;
          if (message.startsWith('unknown run:')) {
            fail('I could not find that run. Send the link again and I\u2019ll start over.');
            return;
          } else if (message.startsWith('no open ')) {
            fail('That question is no longer open. Send the link again and I\u2019ll start over.');
            return;
          } else if (message.startsWith('unsafe run id:')) {
            fail('That run id looks wrong. Send the link again and I\u2019ll start over.');
            return;
          }
        }
        const ref = logServerError('resume', err);
        fail(userErrorWithRef('Something went wrong on my side. Give it a minute and try again.', ref));
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
