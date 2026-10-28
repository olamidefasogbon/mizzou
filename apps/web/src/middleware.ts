import { NextResponse, type NextRequest } from 'next/server';
import { ANON_COOKIE } from './lib/session';

// Per-browser anonymous id until Supabase auth lands. No secrets involved.

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  if (!request.cookies.get(ANON_COOKIE)) {
    response.cookies.set(ANON_COOKIE, crypto.randomUUID(), {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
