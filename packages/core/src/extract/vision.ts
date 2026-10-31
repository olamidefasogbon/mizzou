import 'server-only';
import { BudgetGuard } from '../meta/budget.js';
import { callModel } from '../meta/callModel.js';
import { Extraction, ExtractionSchema } from '../schemas/extraction.js';
import { VISION_SYSTEM_PROMPT, buildVisionPrompt } from '../prompts/reader.js';
import { verifyVisionEvidence } from './evidence.js';

export interface ImageReadParams {
  /** Human file name shown on cards (never trusted for facts). */
  name: string;
  /** Evidence source id, always `upload:{uploadId}`. */
  sourceUrl: string;
  /** Image data URL (client-downscaled to 1600px on the long side). */
  dataUrl: string;
  userId?: string;
  budgetGuard?: BudgetGuard;
  /** Inject a stub in tests; defaults to the vision role (no paid runs in tests). */
  call?: typeof callModel;
}

export interface ImageReadResult {
  extraction: Extraction;
  costUsd: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

// Vision role (PROMPT.md 4, flyers): the image goes straight to the
// vision-capable model asking for the SAME extraction schema, with evidence
// rules (a quote or region note per field, never invented dates). The
// vision post-check marks invented dates low/unchecked; quote presence
// against image text stays the prompt's job (no page corpus exists).
export async function readImageExtraction(params: ImageReadParams): Promise<ImageReadResult> {
  const call = params.call ?? callModel;
  const result = await call({
    role: 'vision',
    systemPrompt: VISION_SYSTEM_PROMPT,
    prompt: buildVisionPrompt(params.sourceUrl),
    images: [params.dataUrl],
    schema: ExtractionSchema,
    temperature: 0,
    userId: params.userId ?? 'dev',
    budgetGuard: params.budgetGuard,
  });
  return {
    extraction: verifyVisionEvidence(result.data as Extraction),
    costUsd: result.costUsd,
    model: result.model,
    inputTokens: result.usage?.prompt_tokens ?? 0,
    outputTokens: result.usage?.completion_tokens ?? 0,
  };
}
