'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { ensureAnonymousSession } from '@/lib/anonymous';

// Landing entry points. No signup required: "Try it for free" ensures an
// anonymous session silently and opens /app. "Log in" is only for
// returning users: plain Google OAuth with no session, linkIdentity when
// one exists so the visitor's chats and reminders carry over.

function oauthError(friendly: string, detail: string): string {
  return process.env.NODE_ENV === 'production' ? friendly : `${friendly} (${detail})`;
}

export function TryButton({ className }: { className: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await ensureAnonymousSession(supabaseBrowser().auth);
      router.push('/app');
    } catch (err) {
      setError(oauthError('Could not start. Give it a minute and try again.', err instanceof Error ? err.message : String(err)));
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={() => void start()} disabled={busy}>
        {busy ? 'Starting…' : 'Try it for free'}
      </button>
      {error ? (
        <p role="alert" style={{ marginTop: 8, fontSize: 13 }}>
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
        setError(oauthError('Google sign-in did not start. Try again.', res.error.message));
        setBusy(false);
        return;
      }
      const url = (res.data as { url?: string } | null)?.url;
      if (url) window.location.assign(url);
      // Otherwise the client is already redirecting; stay busy.
    } catch (err) {
      setError(oauthError('Google sign-in did not start. Try again.', err instanceof Error ? err.message : String(err)));
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={() => void login()} disabled={busy}>
        {busy ? 'Connecting…' : 'Log in'}
      </button>
      {error ? (
        <p role="alert" style={{ marginTop: 8, fontSize: 13 }}>
          {error}
        </p>
      ) : null}
    </>
  );
}
