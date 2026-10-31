import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Next 16 convention: proxy.ts (was middleware.ts).
// Refreshes the Supabase session on every pass so server clients see a
// live user. No signup required: when there is no session yet, mint a
// Supabase anonymous session silently so /app and the API routes always
// have a user id. A mint failure is not fatal — the landing's Try button
// ensures a session client-side, and server routes answer accordingly.

export default async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    try {
      // No captcha token server-side: when the project enforces captcha
      // for anonymous sign-ins this mint fails and the landing's Turnstile
      // widget handles first touch instead.
      await supabase.auth.signInAnonymously();
    } catch {
      // Supabase unreachable or anonymous sign-ins disabled: leave the
      // request sessionless. Routes answer with a retryable friendly
      // message instead of a login wall.
    }
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
