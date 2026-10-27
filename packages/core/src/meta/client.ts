import OpenAI from 'openai';

// PROMPT.md section 4 names this env var MODEL_API_KEY; META_API_KEY is
// accepted as a fallback for earlier local setups. Decision recorded in
// STATUS.md: the documented name wins.
const apiKey = process.env.MODEL_API_KEY || process.env.META_API_KEY || '';

export const metaClient = new OpenAI({
  apiKey,
  baseURL: 'https://api.meta.ai/v1',
});
