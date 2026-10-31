// Raw Model API /v1/responses transport for the orchestrator loop
// (docs/META_API_NOTES.md section 5: verified shapes only).
// The key is read on first call, like getMetaClient. Function tools,
// previous_response_id chaining, and usage accounting live here.

import 'server-only';
import { META_BASE_URL, readApiKey } from './client.js';
import { BudgetExceededError, BudgetGuard, defaultBudgetGuard } from './budget.js';

export type ResponsesEffort = 'minimal' | 'low' | 'medium' | 'high';

export interface ResponsesFunctionTool {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ResponsesBuiltinTool = { type: 'web_search' } | { type: 'web_search'; [key: string]: unknown };

export type ResponsesTool = ResponsesFunctionTool | ResponsesBuiltinTool;

export interface ResponsesItem {
  type: string;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  status?: string;
  role?: string;
  content?: Array<{ type: string; text?: string }>;
}

export interface ResponsesCallOptions {
  model: string;
  effort?: ResponsesEffort;
  systemPrompt?: string;
  /** First turn: a string. Later turns: function_call_output items. */
  input: unknown;
  tools?: ResponsesTool[];
  previousResponseId?: string | null;
  userId?: string;
  budgetGuard?: BudgetGuard;
  timeoutMs?: number;
}

export interface ResponsesCallResult {
  responseId: string;
  items: ResponsesItem[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export async function responsesCall(opts: ResponsesCallOptions): Promise<ResponsesCallResult> {
  const guard = opts.budgetGuard ?? defaultBudgetGuard;
  const userId = opts.userId ?? 'dev';
  const promptText = typeof opts.input === 'string' ? opts.input : JSON.stringify(opts.input).slice(0, 4000);
  guard.checkBeforeCall({ userId, model: opts.model, promptText });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
  try {
    const res = await fetch(`${META_BASE_URL}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${readApiKey()}` },
      body: JSON.stringify({
        model: opts.model,
        reasoning: { effort: opts.effort ?? 'medium' },
        ...(opts.systemPrompt ? { instructions: opts.systemPrompt } : {}),
        input: opts.input,
        ...(opts.tools ? { tools: opts.tools } : {}),
        ...(opts.previousResponseId ? { previous_response_id: opts.previousResponseId } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = new Error(`responses API HTTP ${res.status}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    const body = (await res.json()) as {
      id?: string;
      model?: string;
      output?: ResponsesItem[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const inputTokens = body.usage?.input_tokens ?? 0;
    const outputTokens = body.usage?.output_tokens ?? 0;
    const costUsd = guard.recordCall({ userId, model: opts.model, promptTokens: inputTokens, completionTokens: outputTokens });
    return {
      responseId: body.id ?? '',
      items: body.output ?? [],
      model: body.model ?? opts.model,
      inputTokens,
      outputTokens,
      costUsd,
    };
  } catch (err) {
    if (err instanceof BudgetExceededError) throw err;
    if ((err as { name?: string }).name === 'AbortError') throw new Error('responses call timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface StreamCallbacks {
  onText?: (delta: string) => void;
  onFunctionCall?: (name: string, args: string) => void;
}

export interface StreamCallOptions extends ResponsesCallOptions {
  onText?: (delta: string) => void;
  onFunctionCall?: (name: string, args: string) => void;
}

/**
 * Streaming variant of responsesCall: same request shape plus stream:true,
 * same budget check before the call and the same single ledger entry after
 * the stream completes. Emits text deltas and complete function calls as
 * they arrive. Fails loudly when the provider omits usage — silent $0
 * turns are a bug, not a saving.
 */
export async function streamResponsesCall(opts: StreamCallOptions): Promise<ResponsesCallResult> {
  const guard = opts.budgetGuard ?? defaultBudgetGuard;
  const userId = opts.userId ?? 'dev';
  const promptText = typeof opts.input === 'string' ? opts.input : JSON.stringify(opts.input).slice(0, 4000);
  guard.checkBeforeCall({ userId, model: opts.model, promptText });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 180_000);
  try {
    const res = await fetch(`${META_BASE_URL}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${readApiKey()}` },
      body: JSON.stringify({
        model: opts.model,
        reasoning: { effort: opts.effort ?? 'medium' },
        ...(opts.systemPrompt ? { instructions: opts.systemPrompt } : {}),
        input: opts.input,
        ...(opts.tools ? { tools: opts.tools } : {}),
        ...(opts.previousResponseId ? { previous_response_id: opts.previousResponseId } : {}),
        stream: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      let detail = '';
      try {
        detail = ` ${(await res.text()).slice(0, 500)}`;
      } catch {
        // Body unreadable; status alone must do.
      }
      const err = new Error(`responses stream HTTP ${res.status}${detail}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let responseId = '';
    let responseModel = opts.model;
    const items: ResponsesItem[] = [];
    const argBuffers = new Map<string, string>();
    const callItemById = new Map<string, ResponsesItem>();
    // Every item id pushed below is recorded here. The provider sends each
    // output item twice on the wire (once as output_item.done, once inside
    // the response.completed envelope); without this set the second copy
    // lands in `items` and the next turn 400s on duplicate ids.
    const seenIds = new Set<string>();
    const pushItem = (item: ResponsesItem): void => {
      if (item.id) {
        if (seenIds.has(item.id)) return;
        seenIds.add(item.id);
      }
      items.push(item);
    };
    const done = { value: false };
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') {
          done.value = true;
          continue;
        }
        let event: { type?: string; delta?: string; item?: ResponsesItem; item_id?: string; response?: { id?: string; model?: string; usage?: { input_tokens?: number; output_tokens?: number }; output?: ResponsesItem[] } };
        try {
          event = JSON.parse(payload) as typeof event;
        } catch {
          continue;
        }
        if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
          opts.onText?.(event.delta);
        } else if (event.type === 'response.output_item.added' && event.item && (event.item.type === 'function_call' || event.item.type === 'function_call_output')) {
          pushItem(event.item);
          if (event.item.type === 'function_call' && event.item.id) callItemById.set(event.item.id, event.item);
        } else if (event.type === 'response.function_call_arguments.delta' && event.item_id) {
          argBuffers.set(event.item_id, (argBuffers.get(event.item_id) ?? '') + (event.delta ?? ''));
        } else if (event.type === 'response.output_item.done' && event.item) {
          const existing = event.item.id ? callItemById.get(event.item.id) : undefined;
          if (existing && existing.type === 'function_call') {
            const buffered = event.item.id ? (argBuffers.get(event.item.id) ?? event.item.arguments ?? '') : (event.item.arguments ?? '');
            existing.arguments = buffered;
            opts.onFunctionCall?.(existing.name ?? '', buffered);
          } else {
            pushItem(event.item);
          }
        } else if (event.type === 'response.completed' && event.response) {
          responseId = event.response.id ?? responseId;
          if (event.response.model) responseModel = event.response.model;
          if (!event.response.output || event.response.output.length > 0) {
            for (const item of event.response.output ?? []) {
              if (item.id && callItemById.has(item.id)) {
                const kept = callItemById.get(item.id);
                if (kept && item.type === 'function_call' && (!kept.arguments || kept.arguments.length === 0)) {
                  kept.arguments = item.arguments ?? '';
                  opts.onFunctionCall?.(kept.name ?? '', kept.arguments);
                }
                continue;
              }
              if (item.id && seenIds.has(item.id)) continue;
              pushItem(item);
            }
          }
          const usage = event.response.usage;
          const inputTokens = usage?.input_tokens ?? 0;
          const outputTokens = usage?.output_tokens ?? 0;
          if (!usage) throw new Error('responses stream completed without usage; refusing to log a $0 turn');
          const costUsd = guard.recordCall({ userId, model: opts.model, promptTokens: inputTokens, completionTokens: outputTokens });
          return { responseId, items, model: responseModel, inputTokens, outputTokens, costUsd };
        } else if (event.type === 'response.failed' || event.type === 'response.incomplete') {
          throw new Error(`responses stream ${event.type}`);
        }
      }
    }
    void done;
    throw new Error('responses stream ended without response.completed');
  } catch (err) {
    if (err instanceof BudgetExceededError) throw err;
    if ((err as { name?: string }).name === 'AbortError') throw new Error('responses stream timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
