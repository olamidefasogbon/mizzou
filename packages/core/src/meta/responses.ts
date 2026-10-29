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
  tools?: ResponsesFunctionTool[];
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
