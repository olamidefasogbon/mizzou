import { cookies } from 'next/headers';

// Per-browser anonymous session id until Supabase auth is wired (M7).
// The middleware sets the cookie; server code reads it. First render
// falls back to an ephemeral id, which still renders the empty state.

export const ANON_COOKIE = 'mizzou-anon-id';

export async function anonId(): Promise<string> {
  const jar = await cookies();
  return jar.get(ANON_COOKIE)?.value ?? `ephemeral-${crypto.randomUUID()}`;
}
