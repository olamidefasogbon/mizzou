// Who is making this request. The Supabase user id (Google or anonymous
// sign-in) replaces the mizzou anon cookie everywhere it exists; visitors
// who never signed in keep the cookie id and count as guests.
// Server-only: route handlers, server components and server actions.

import 'server-only';

import { supabaseServer } from './supabase/server';
import { anonId } from './session';

export interface SessionUser {
  userId: string;
  /** True for cookie-only visitors and anonymous sign-ins. */
  isGuest: boolean;
  /** The Supabase auth id, or null when there is no session. Only a real
   * session can satisfy RLS, so only a non-null uid may use Supabase rows. */
  uid: string | null;
}

export async function resolveUser(): Promise<SessionUser> {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      return { userId: data.user.id, isGuest: data.user.is_anonymous === true, uid: data.user.id };
    }
  } catch {
    // Supabase unconfigured or unreachable: fall through to the cookie.
  }
  return { userId: await anonId(), isGuest: true, uid: null };
}
