'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { ensureAnonymousSession } from '@/lib/anonymous';
import { Turnstile } from './turnstile';

// Landing entry points. No signup required: "Try it for free" ensures an
// anonymous session silently and opens /app. "Log in" is only for
// returning users: plain Google OAuth with no session, linkIdentity when
// one exists so the visitor's chats and reminders carry over.

const errorStyle = { margin: '8px 0 0', fontSize: 14, lineHeight: '20px', color: 'var(--mz-error)', textAlign: 'center' } as const;

function oauthError(friendly: string, detail: string): string {
  return process.env.NODE_ENV === 'production' ? friendly : `${friendly} (${detail})`;
}

export function TryButton({ className }: { className: string }) {
  const router = useRouter();
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  async function start(): Promise<void> {
    if (busy) return;
    if (siteKey && !token) {
      setError('Complete the human check, then try again');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await ensureAnonymousSession(supabaseBrowser().auth, token ?? undefined);
      router.push('/app');
    } catch (err) {
      setError(oauthError('Could not start. Try again in a moment', err instanceof Error ? err.message : String(err)));
      setBusy(false);
    }
  }

  return (
    <>
      {siteKey ? <Turnstile onToken={setToken} /> : null}
      <button type="button" className={className} onClick={() => void start()} disabled={busy}>
        {busy ? 'Starting…' : 'Try it for free'}
      </button>
      {error ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : null}
    </>
  );
}

export function LoginButton({ className }: { className: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function login(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const redirectTo = `${window.location.origin}/auth/callback`;
      const { data } = await supabase.auth.getSession();
      const res = data.session
        ? await supabase.auth.linkIdentity({ provider: 'google', options: { redirectTo } })
        : await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
      if (res.error) {
        setError(oauthError('Google sign-in did not start. Try again', res.error.message));
        setBusy(false);
        return;
      }
      const url = (res.data as { url?: string } | null)?.url;
      if (url) window.location.assign(url);
      // Otherwise the client is already redirecting; stay busy.
    } catch (err) {
      setError(oauthError('Google sign-in did not start. Try again', err instanceof Error ? err.message : String(err)));
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={() => void login()} disabled={busy}>
        {busy ? 'Connecting…' : 'Log in'}
      </button>
      {error ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : null}
    </>
  );
}
