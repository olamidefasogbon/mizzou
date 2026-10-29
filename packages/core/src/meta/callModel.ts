import 'server-only';
import { z } from 'zod';
import { getMetaClient } from './client.js';
import { ModelRole, ROLE_MODEL_MAP } from './registry.js';
import { BudgetExceededError, BudgetGuard, defaultBudgetGuard } from './budget.js';

export { BudgetExceededError };

interface CallModelOptions<T extends z.ZodTypeAny> {
  role: ModelRole;
  prompt: string;
  systemPrompt?: string;
  schema?: T;
  temperature?: number;
  /** Owning user for budget accounting. Defaults to 'dev'. */
  userId?: string;
  /** Guests are additionally capped by GUEST_RUNS_PER_DAY. */
  isGuest?: boolean;
  /** Inject a guard in tests; defaults to the shared process guard. */
  budgetGuard?: BudgetGuard;
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
  schema,
  temperature = 0.2,
  userId = 'dev',
  isGuest = false,
  budgetGuard = defaultBudgetGuard,
}: CallModelOptions<T>): Promise<CallModelResult<z.infer<T>>> {
  const model = ROLE_MODEL_MAP[role];

  // Budget guard (section 9.3): check BEFORE sending. A hit throws
  // BudgetExceededError with the friendly message; never retried.
  budgetGuard.checkBeforeCall({ userId, model, promptText: systemPrompt ? `${systemPrompt}\n${prompt}` : prompt, isGuest });

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

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
    try {
      const response = await getMetaClient().chat.completions.create({
        model,
        messages,
        temperature,
        ...(schema ? { response_format: { type: 'json_object' } } : {}),
      });

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
        });

        const repairContent = repairResponse.choices[0]?.message?.content || '';
        const repairJson = JSON.parse(repairContent);
        const repairedData = schema.parse(repairJson);
        const { usage, costUsd } = record(repairResponse.usage);
        return { data: repairedData, model, usage: usage ?? response.usage, costUsd };
      }
    } catch (err: unknown) {
      if (err instanceof BudgetExceededError) throw err;
      const status = (err as { status?: number })?.status;
      if (status === 429 && attempt < MAX_ATTEMPTS) {
        await sleep(delay);
        delay *= 2;
        continue;
      }
      throw err;
    }
  }

  throw new Error(`callModel failed for role ${role} after ${MAX_ATTEMPTS} attempts.`);
}
