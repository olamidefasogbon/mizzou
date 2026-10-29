import 'server-only';

// Model pricing in USD per 1M tokens, from PROMPT.md section 4
// (official model list and pricing pages, checked Oct 27).
// Search grounding: $2.50 per 1,000 queries. Voice transcribe: $0.18/hour.

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'muse-spark-1.3': { inputPerMTok: 1.25, outputPerMTok: 4.25 },
  'muse-wonder-1.0': { inputPerMTok: 4.0, outputPerMTok: 20.0 },
};

const DEFAULT_PRICE: ModelPrice = MODEL_PRICES['muse-spark-1.3'];

export function priceFor(model: string): ModelPrice {
  return MODEL_PRICES[model] ?? DEFAULT_PRICE;
}

/** Estimated cost in USD for a call with the given token counts. */
export function costForCall(model: string, promptTokens: number, completionTokens: number): number {
  const p = priceFor(model);
  return (promptTokens * p.inputPerMTok + completionTokens * p.outputPerMTok) / 1_000_000;
}

/** Rough pre-call estimate from prompt text length (~4 chars per token). */
export function estimateCostForPrompt(model: string, promptText: string): number {
  const guessedPromptTokens = Math.ceil(promptText.length / 4);
  // Assume a modest completion for estimation; actuals are recorded after the call.
  return costForCall(model, guessedPromptTokens, 500);
}
