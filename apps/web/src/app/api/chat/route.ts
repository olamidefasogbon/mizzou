import {
  BudgetExceededError,
  BudgetGuard,
  budgetFriendlyMessage,
  encodeSseEvent,
  ExtractionSchema,
  generateChatTitle,
  limitsFromEnv,
  newRun,
  runConversationTurn,
  type RunEvent,
  type VisionSeed,
} from '@mizzou/core';
import { AuthRequiredError, resolveUser } from '@/lib/auth';
import { logServerError, userErrorWithRef } from '@/lib/errors';
import { repo, adaptDb } from '@/lib/repo';
import { abuseLimitsFromEnv, checkHitRate, checkMessageLength, checkNewRun, clientIp, logCapRefusal, supabaseCounterStore } from '@/lib/caps';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { RequestUsageStore } from '@/lib/usage';
import { isUploadId } from '@/lib/upload-id';
import { turnBudgetMs } from '@/lib/turn-budget';

// Vercel Hobby maximum is 60s (PROMPT.md 9.2 says platform maximum —
// confirm against the Vercel plan at deploy; raise this when the plan grows).
export const maxDuration = 60;

// POST /api/chat — one model-driven conversation turn per message
// (docs/design/AGENT_BRAIN.md sections 1-2). No regex or URL branching on
// the message text: the orchestrator decides which tools to call. The
// client sends back the runId from the last done event so turns chain one
// run with stored server history.
export async function POST(req: Request): Promise<Response> {
  let message = '';
  let chatId: string | null = null;
  let requestedRunId: string | null = null;
  const visionSeeds: VisionSeed[] = [];
  let timezone = 'Africa/Lagos';
  try {
    const body: unknown = await req.json();
    if (typeof (body as { message?: unknown }).message === 'string') {
      message = (body as { message: string }).message;
    }
    if (typeof (body as { chatId?: unknown }).chatId === 'string') {
      chatId = (body as { chatId: string }).chatId;
    }
    if (typeof (body as { runId?: unknown }).runId === 'string') {
      requestedRunId = (body as { runId: string }).runId;
    }
    if (typeof (body as { timezone?: unknown }).timezone === 'string' && (body as { timezone: string }).timezone.trim().length > 0) {
      timezone = (body as { timezone: string }).timezone.slice(0, 80);
    }
    // Vision-role extraction from /api/upload (schema-validated, never
    // trusted blind): enters the turn as a merge-only seed for G1.
    const vision = (body as { vision?: unknown }).vision;
    if (Array.isArray(vision)) {
      for (const seed of vision.slice(0, 3)) {
        const s = seed as { id?: unknown; name?: unknown; extraction?: unknown };
        if (!isUploadId(s.id)) continue;
        const parsed = ExtractionSchema.safeParse(s.extraction);
        if (!parsed.success) continue;
        visionSeeds.push({
          id: s.id,
          name: typeof s.name === 'string' ? s.name.slice(0, 120) : 'upload',
          extraction: parsed.data,
        });
      }
    }
  } catch {
    message = '';
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (e: RunEvent): void => {
        controller.enqueue(enc.encode(encodeSseEvent(e)));
      };

      try {
        if (!message.trim()) {
          send({ t: 'error', friendly: 'Type a message to get started.' });
          send({ t: 'done', runId: requestedRunId ?? '' });
          controller.close();
          return;
        }
        let userId: string;
        try {
          ({ userId } = await resolveUser());
        } catch (err) {
          if (err instanceof AuthRequiredError) {
            send({ t: 'error', friendly: 'Give it a minute and try again.' });
            send({ t: 'done', runId: requestedRunId ?? '' });
            controller.close();
            return;
          }
          throw err;
        }
        const db = await repo();
        const store = db.runs;
        const existing = requestedRunId ? await store.load(requestedRunId) : null;
        const run = existing ?? newRun(requestedRunId ?? crypto.randomUUID(), userId, chatId);
        if (!run.userId) run.userId = userId;
        const runId = run.id;
        const fail = (friendly: string, link?: string): void => {
          send({ t: 'error', friendly, link });
          send({ t: 'done', runId });
          controller.close();
        };

        // Abuse caps (model-free friendly refusals, run still recorded):
        // message length, per-minute rate, then per-IP daily runs for new runs.
        const limits = abuseLimitsFromEnv();
        const tooLong = checkMessageLength(message, limits);
        if (!tooLong.ok) {
          logCapRefusal(tooLong.detail);
          fail(tooLong.message);
          return;
        }
        const counters = supabaseCounterStore(adaptDb(supabaseAdmin()));
        const ip = clientIp(req);
        const hit = await checkHitRate(counters, ip, limits);
        if (!hit.ok) {
          logCapRefusal(hit.detail);
          try {
            await store.save(run);
          } catch (saveErr) {
            logServerError('chat-cap-save', saveErr);
          }
          fail(hit.message);
          return;
        }
        if (!existing) {
          const runs = await checkNewRun(counters, ip, limits);
          if (!runs.ok) {
            logCapRefusal(runs.detail);
            try {
              await store.save(run);
            } catch (saveErr) {
              logServerError('chat-cap-save', saveErr);
            }
            fail(runs.message);
            return;
          }
        }

        // Name the chat right away, in parallel with the turn, from the first
        // message alone. It lands in the panel as soon as it is ready.
        let titleDone: Promise<void> = Promise.resolve();
        if (!existing && chatId) {
          const titleChatId = chatId;
          titleDone = (async () => {
            try {
              const taken = (await db.chats.list(userId)).filter((c) => c.id !== titleChatId).map((c) => c.title);
              const title = await generateChatTitle(message, '', userId, taken);
              await db.chats.rename(titleChatId, userId, title);
            } catch (titleErr) {
              logServerError('chat-title', titleErr);
            }
          })();
        }

        const snapshot = await db.usage.snapshot(userId);
        const usageStore = new RequestUsageStore(snapshot.userSpend, snapshot.globalSpend);
        const budgetGuard = new BudgetGuard(usageStore, limitsFromEnv());
        let timedOut = false;
        try {
          const turn = await runConversationTurn({

            run,
            save: (r) => store.save(r),
            deadlineAtMs: Date.now() + turnBudgetMs(),
            userText: message,
            polishAnswers: process.env['MIZZOU_POLISH'] === '1',
            silentNarration: true,
            seedExtractions: visionSeeds,
            timezone,
            userId: run.userId ?? userId,
            budgetGuard,
            send,
            listReminders: async () =>
              (await db.reminders.list(userId)).map((r) => ({
                id: r.id,
                text: r.sub ? `${r.title}, ${r.sub}` : r.title,
                dueAt: r.dueAt,
              })),
          });
          timedOut = turn.timedOut === true;
        } catch (err) {
          if (err instanceof BudgetExceededError) {
            console.warn(`[mizzou:budget] refusal scope=${err.scope} amount=${err.amount} limit=${err.limit}`);
            fail(budgetFriendlyMessage(err.scope));
          } else {
            const ref = logServerError('chat', err);
            fail(userErrorWithRef('Something went wrong on my side. Give it a minute and try again.', ref));
          }
          return;
        } finally {
          try {
            await db.usage.flush(usageStore.pending(), runId);
          } catch (flushErr) {
            logServerError('chat-usage', flushErr);
          }
        }
        await titleDone;
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
        if (timedOut) send({ t: 'continue', runId });
        send({ t: 'done', runId });
        controller.close();
      } catch (err) {
        const ref = logServerError('chat', err);
        send({
          t: 'error',
          friendly: userErrorWithRef('Something went wrong on my side. Give it a minute and try again.', ref),
        });
        send({ t: 'done', runId: requestedRunId ?? '' });
        controller.close();
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
