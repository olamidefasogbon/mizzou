// Browser Supabase client (anon key). Imported by client components for
// sign-in, sign-out and session reads. Never the service role key.

import { createBrowserClient } from '@supabase/ssr';
import { requiredEnv } from './env';

type BrowserClient = ReturnType<typeof createBrowserClient>;

let browser: BrowserClient | undefined;

export function supabaseBrowser(): BrowserClient {
  browser ??= createBrowserClient(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  );
  return browser;
}
