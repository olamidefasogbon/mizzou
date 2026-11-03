import 'server-only';
import { z } from 'zod';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { getMetaClient } from './client.js';
import { ModelRole, ROLE_MODEL_MAP } from './registry.js';
import { BudgetExceededError, BudgetGuard, defaultBudgetGuard } from './budget.js';

export { BudgetExceededError };

/** A model call that outran its per-call budget. Callers turn this into a structured tool error, never a retry storm. */
export class ModelTimeoutError extends Error {
  readonly role: ModelRole;
  readonly timeoutMs: number;
  constructor(role: ModelRole, timeoutMs: number) {
    super(`${role} model call timed out after ${timeoutMs}ms`);
    this.name = 'ModelTimeoutError';
    this.role = role;
    this.timeoutMs = timeoutMs;
  }
}

/** Default ceiling for one model call. The reader passes a shorter one. */
export const DEFAULT_MODEL_TIMEOUT_MS = 30_000;

interface CallModelOptions<T extends z.ZodTypeAny> {
  role: ModelRole;
  prompt: string;
  systemPrompt?: string;
  /** Image data URLs for image-input roles (vision). Sent as image_url parts. */
  images?: string[];
  schema?: T;
  temperature?: number;
  /** Owning user for budget accounting. Defaults to 'dev'. */
  userId?: string;
  /** Inject a guard in tests; defaults to the shared process guard. */
  budgetGuard?: BudgetGuard;
  /** Per-call ceiling in ms. Defaults to DEFAULT_MODEL_TIMEOUT_MS. */
  timeoutMs?: number;
}

export interface CallModelResult<T> {
  data: T | string;
  model: string;
  costUsd: number;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_ATTEMPTS = 3;

export async function callModel<T extends z.ZodTypeAny = z.ZodString>({
  role,
  prompt,
  systemPrompt,
  images,
  schema,
  temperature = 0.2,
  userId = 'dev',
  budgetGuard = defaultBudgetGuard,
  timeoutMs = DEFAULT_MODEL_TIMEOUT_MS,
}: CallModelOptions<T>): Promise<CallModelResult<z.infer<T>>> {
  const model = ROLE_MODEL_MAP[role];

  // Budget guard (section 9.3): check BEFORE sending. A hit throws
  // BudgetExceededError with the friendly message; never retried.
  budgetGuard.checkBeforeCall({ userId, model, promptText: systemPrompt ? `${systemPrompt}\n${prompt}` : prompt });

  const messages: ChatCompletionMessageParam[] = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  if (images && images.length > 0) {
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: prompt }, ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } }))],
    });
  } else {
    messages.push({ role: 'user', content: prompt });
  }

  const record = (usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }) => {
    const costUsd = budgetGuard.recordCall({
      userId,
      model,
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
    });
    return { usage, costUsd };
  };

  let attempt = 0;
  let delay = 1000;

  while (attempt < MAX_ATTEMPTS) {
    attempt += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await getMetaClient().chat.completions.create({
        model,
        messages,
        temperature,
        ...(schema ? { response_format: { type: 'json_object' } } : {}),
      }, { signal: controller.signal });

      const content = response.choices[0]?.message?.content || '';

      if (!schema) {
        const { usage, costUsd } = record(response.usage);
        return { data: content as z.infer<T>, model, usage, costUsd };
      }

      try {
        const json = JSON.parse(content);
        const parsed = schema.parse(json);
        const { usage, costUsd } = record(response.usage);
        return { data: parsed, model, usage, costUsd };
      } catch (validationErr: unknown) {
        // Exactly one repair retry, then stop and report (spend rules).
        const message = validationErr instanceof Error ? validationErr.message : String(validationErr);
        const repairResponse = await getMetaClient().chat.completions.create({
          model,
          messages: [
            ...messages,
            { role: 'assistant', content },
            {
              role: 'user',
              content: `Your response failed validation with error: ${message}. Return ONLY a valid JSON object matching the requested schema.`,
            },
          ],
          temperature: 0.0,
          response_format: { type: 'json_object' },
        }, { signal: controller.signal });

        const repairContent = repairResponse.choices[0]?.message?.content || '';
        const repairJson = JSON.parse(repairContent);
        const repairedData = schema.parse(repairJson);
        const { usage, costUsd } = record(repairResponse.usage);
        return { data: repairedData, model, usage: usage ?? response.usage, costUsd };
      }
    } catch (err: unknown) {
      if (err instanceof BudgetExceededError) throw err;
      {
        const e = err as { name?: string; message?: string };
        if (e?.name === 'AbortError' || e?.name === 'APIUserAbortError' || e?.message === 'Request was aborted.') throw new ModelTimeoutError(role, timeoutMs);
      }
      const status = (err as { status?: number })?.status;
      if (status === 429 && attempt < MAX_ATTEMPTS) {
        await sleep(delay);
        delay *= 2;
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`callModel failed for role ${role} after ${MAX_ATTEMPTS} attempts.`);
}
