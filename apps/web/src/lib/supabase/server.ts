// Server Supabase client (anon key, cookie session). For route handlers
// and server components; RLS applies through the user's session.

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { requiredEnv } from './env';

export async function supabaseServer(): Promise<ReturnType<typeof createServerClient>> {
  const jar = await cookies();
  return createServerClient(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (toSet) => {
          // Called from a server component render this throws; the proxy
          // refresh below is what actually persists rotated cookies.
          try {
            toSet.forEach(({ name, value, options }) => jar.set(name, value, options));
          } catch {
            // Ignored on purpose: session refresh happens in proxy.ts.
          }
        },
      },
    },
  );
}
