// Google upgrade for guests (client-safe: no server-only import).
// linkIdentity upgrades the anonymous user in place, so the same user id
// keeps every chat and reminder. The auth dependency is injected so tests
// can pass a mock; components pass supabaseBrowser().auth and assign the
// returned url themselves (window is a component concern, not this helper).

export interface LinkAuth {
  linkIdentity(args: { provider: 'google'; options: { redirectTo: string; scopes?: string } }): Promise<{
    data: { url?: string } | null;
    error: { message: string } | null;
  }>;
}

export type UpgradeResult = { url: string } | { error: string };

/**
 * Start the Google link flow. Returns the OAuth url or a friendly error.
 * `next` is an optional /app return path the callback redirects to after
 * linking (validated there), so an approval can resume where it started.
 * `scopes` requests incremental consent (Calendar sync) only at the moment
 * the user approves a write; omit it for the plain sign-in upgrade.
 */
export async function upgradeToGoogle(auth: LinkAuth, origin: string, next?: string, scopes?: string): Promise<UpgradeResult> {
  const redirectTo =
    typeof next === 'string' && next.startsWith('/app') ? `${origin}/auth/callback?next=${encodeURIComponent(next)}` : `${origin}/auth/callback`;
  try {
    const res = await auth.linkIdentity({ provider: 'google', options: scopes ? { redirectTo, scopes } : { redirectTo } });
    if (res.error) return { error: 'Google sign-in did not start. Try again.' };
    const url = res.data?.url;
    if (typeof url !== 'string' || url.length === 0) return { error: 'Google sign-in did not start. Try again.' };
    return { url };
  } catch {
    return { error: 'Google sign-in did not start. Try again.' };
  }
}
