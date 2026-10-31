// Who is making this request. No signup required: first touch mints a
// Supabase anonymous session (proxy.ts), so every visitor has a user id
// and RLS rows. Google is an optional upgrade via linkIdentity.
// Server-only: route handlers, server components and server actions.

import 'server-only';

import { supabaseServer } from './supabase/server.ts';

export interface SessionUser {
  userId: string;
  /** True for anonymous sessions; false once linked to Google. */
  isGuest: boolean;
  /** The Supabase auth id. Anonymous sessions satisfy RLS like any user. */
  uid: string;
  /** Null for guests; real name once linked. */
  name: string | null;
  /** Null for guests; Google email once linked. */
  email: string | null;
}

export class AuthRequiredError extends Error {
  constructor() {
    super('AUTH_REQUIRED');
    this.name = 'AuthRequiredError';
  }
}

/**
 * The current user. Anonymous sessions count as guests but are fully
 * usable. Throws AuthRequiredError only when no session exists at all
 * (the proxy mints one on every pass, so this means Supabase is down).
 */
export async function resolveUser(): Promise<SessionUser> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) throw new AuthRequiredError();
  const guest = user.is_anonymous === true;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const rawName = meta['full_name'] ?? meta['name'] ?? null;
  return {
    userId: user.id,
    isGuest: guest,
    uid: user.id,
    name: guest ? null : typeof rawName === 'string' && rawName.length > 0 ? rawName : null,
    email: guest ? null : typeof user.email === 'string' ? user.email : null,
  };
}
