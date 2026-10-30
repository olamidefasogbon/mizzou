// Who is making this request. Google sign-in only: every app surface
// requires a Supabase session (no guests, no anon cookie). Callers that
// serve signed-out visitors (the /app gate, API routes) catch
// AuthRequiredError and redirect or answer accordingly.
// Server-only: route handlers, server components and server actions.

import 'server-only';

import { supabaseServer } from './supabase/server.ts';

export interface SessionUser {
  userId: string;
  /** The Supabase auth id. Only a real session can satisfy RLS. */
  uid: string;
  name: string | null;
  email: string | null;
}

export class AuthRequiredError extends Error {
  constructor() {
    super('AUTH_REQUIRED');
    this.name = 'AuthRequiredError';
  }
}

/** The signed-in user. Throws AuthRequiredError when there is no session. */
export async function resolveUser(): Promise<SessionUser> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) throw new AuthRequiredError();
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const rawName = meta['full_name'] ?? meta['name'] ?? null;
  return {
    userId: user.id,
    uid: user.id,
    name: typeof rawName === 'string' && rawName.length > 0 ? rawName : null,
    email: typeof user.email === 'string' ? user.email : null,
  };
}
