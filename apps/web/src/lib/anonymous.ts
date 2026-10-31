// Anonymous session helper (client-safe: no server-only import).
// No signup required: first touch ensures a Supabase anonymous session,
// silently when one already exists. The auth dependency is injected so
// tests can pass a mock; production passes supabaseBrowser().auth.

export interface AnonymousAuth {
  getSession(): Promise<{ data: { session: unknown | null } }>;
  signInAnonymously(options?: { options?: { captchaToken?: string } }): Promise<{
    error: { message: string } | null;
  }>;
}

/**
 * Return 'existing' when a session is already present, otherwise mint an
 * anonymous one. Throws the provider message when minting fails.
 */
export async function ensureAnonymousSession(
  auth: AnonymousAuth,
  captchaToken?: string,
): Promise<'existing' | 'created'> {
  const { data } = await auth.getSession();
  if (data.session) return 'existing';
  const { error } = await auth.signInAnonymously(captchaToken ? { options: { captchaToken } } : undefined);
  if (error) throw new Error(error.message);
  return 'created';
}

/**
 * Production entry point: the browser Supabase client. The import is lazy
 * so plain node:test can cover ensureAnonymousSession without the `@/`
 * client module; the browser bundle resolves it normally.
 */
export async function ensureAnonymousBrowser(captchaToken?: string): Promise<'existing' | 'created'> {
  const { supabaseBrowser } = await import('@/lib/supabase/client');
  return ensureAnonymousSession(supabaseBrowser().auth, captchaToken);
}
