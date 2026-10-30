import {
  BudgetExceededError,
  BudgetGuard,
  budgetFriendlyMessage,
  encodeSseEvent,
  generateChatTitle,
  limitsFromEnv,
  newRun,
  runConversationTurn,
  type RunEvent,
} from '@mizzou/core';
import { AuthRequiredError, resolveUser } from '@/lib/auth';
import { logServerError, userErrorWithRef } from '@/lib/errors';
import { repo } from '@/lib/repo';
import { RequestUsageStore } from '@/lib/usage';

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
            send({ t: 'error', friendly: 'Sign in with Google to continue.' });
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

        const snapshot = await db.usage.snapshot(userId);
        const usageStore = new RequestUsageStore(snapshot.userSpend, snapshot.globalSpend);
        const budgetGuard = new BudgetGuard(usageStore, limitsFromEnv());
        try {
          await runConversationTurn({
            run,
            save: (r) => store.save(r),
            userText: message,
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
        } catch (err) {
          if (err instanceof BudgetExceededError) {
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
        if (!existing && chatId) {
          // First exchange: write a short model-generated title (falls
          // back to the opening message) so the panel never shows one.
          const assistantTexts = run.messages
            .map((m) => m as { role?: unknown; text?: unknown })
            .filter((m) => m.role === 'assistant' && typeof m.text === 'string' && m.text.length > 0)
            .map((m) => m.text as string);
          const title = await generateChatTitle(message, assistantTexts[assistantTexts.length - 1] ?? '');
          await db.chats.rename(chatId, userId, title);
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
