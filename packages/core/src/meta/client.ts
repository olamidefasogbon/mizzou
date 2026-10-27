import OpenAI from 'openai';

export const metaClient = new OpenAI({
  apiKey: process.env.META_API_KEY || '',
  baseURL: 'https://api.meta.ai/v1',
});