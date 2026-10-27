import { z } from 'zod';
import { metaClient } from './client.js';
import { ModelRole, ROLE_MODEL_MAP } from './registry.js';

interface CallModelOptions<T extends z.ZodTypeAny> {
  role: ModelRole;
  prompt: string;
  systemPrompt?: string;
  schema?: T;
  temperature?: number;
}

export interface CallModelResult<T> {
  data: T | string;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callModel<T extends z.ZodTypeAny = z.ZodString>({
  role,
  prompt,
  systemPrompt,
  schema,
  temperature = 0.2,
}: CallModelOptions<T>): Promise<CallModelResult<z.infer<T>>> {
  const model = ROLE_MODEL_MAP[role];
  let retries = 3;
  let delay = 1000;

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  while (retries > 0) {
    try {
      const response = await metaClient.chat.completions.create({
        model,
        messages,
        temperature,
        ...(schema ? { response_format: { type: 'json_object' } } : {}),
      });

      const content = response.choices[0]?.message?.content || '';

      if (!schema) {
        return {
          data: content as z.infer<T>,
          model,
          usage: response.usage,
        };
      }

      try {
        const json = JSON.parse(content);
        const parsed = schema.parse(json);
        return {
          data: parsed,
          model,
          usage: response.usage,
        };
      } catch (validationErr: any) {
        const repairResponse = await metaClient.chat.completions.create({
          model,
          messages: [
            ...messages,
            { role: 'assistant', content },
            {
              role: 'user',
              content: `Your response failed validation with error: ${validationErr.message}. Return ONLY a valid JSON object matching the requested schema.`,
            },
          ],
          temperature: 0.0,
          response_format: { type: 'json_object' },
        });

        const repairContent = repairResponse.choices[0]?.message?.content || '';
        const repairJson = JSON.parse(repairContent);
        const repairedData = schema.parse(repairJson);

        return {
          data: repairedData,
          model,
          usage: repairResponse.usage,
        };
      }
    } catch (err: any) {
      if (err?.status === 429 && retries > 1) {
        await sleep(delay);
        delay *= 2;
        retries--;
        continue;
      }
      throw err;
    }
  }

  throw new Error(`callModel failed for role ${role} after retries.`);
}