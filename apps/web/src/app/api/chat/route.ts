import {
  BudgetExceededError,
  encodeSseEvent,
  newRun,
  runConversationTurn,
  type RunEvent,
} from '@mizzou/core';
import { resolveUser } from '@/lib/auth';
import { assertGuestRunAllowed, guestRunLimit } from '@/lib/caps';
import { repo } from '@/lib/repo';

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
        const { userId, isGuest } = await resolveUser();
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
        if (!existing && isGuest) {
          try {
            assertGuestRunAllowed(await store.countStartedToday(userId), guestRunLimit());
          } catch (err) {
            fail(err instanceof Error ? err.message : 'I need a minute.');
            return;
          }
        }

        try {
          await runConversationTurn({
            run,
            save: (r) => store.save(r),
            userText: message,
            userId: run.userId ?? userId,
            isGuest,
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
            fail('I need a minute.');
          } else {
            fail('Something went wrong on my side. Give it a minute and try again.');
          }
          return;
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
      } catch {
        send({ t: 'error', friendly: 'Something went wrong on my side. Give it a minute and try again.' });
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
