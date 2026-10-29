import 'server-only';
import OpenAI from 'openai';

// PROMPT.md section 4 names this env var MODEL_API_KEY; META_API_KEY is
// accepted as a fallback for earlier local setups. Decision recorded in
// STATUS.md: the documented name wins.
//
// Lazy singleton: building the client at import time crashed browser
// bundles with "Missing credentials". The key is read on first call,
// which always runs on the server.

let cached: OpenAI | undefined;

export function getMetaClient(): OpenAI {
  if (!cached) {
    cached = new OpenAI({
      apiKey: process.env.MODEL_API_KEY || process.env.META_API_KEY || '',
      baseURL: 'https://api.meta.ai/v1',
    });
  }
  return cached;
}
