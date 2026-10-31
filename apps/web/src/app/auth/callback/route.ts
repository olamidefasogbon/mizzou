import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// GET /auth/callback — finishes Google OAuth for returning users and the
// anonymous linkIdentity upgrade for guests (same user id keeps all rows).
// Google redirects here with a code; exchanging it sets the session cookies,
// then the user continues into /app.

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  // Optional return path from an incremental link (approve-and-sync):
  // same-origin /app paths only, never an open redirect.
  const next = url.searchParams.get('next');
  const dest = next !== null && next.startsWith('/app') ? next : '/app';
  if (!code) {
    return NextResponse.redirect(new URL('/?error=missing-code', request.url));
  }
  const response = NextResponse.redirect(new URL(dest, request.url));
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL('/?error=oauth', request.url));
  }
  return response;
}
