'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

// Sign-up buttons. Google OAuth and anonymous guest sign-in both live in
// Supabase: a visitor with no session gets signInWithOAuth, an anonymous
// guest upgrades in place with linkIdentity so their runs carry over.

export function SignupActions({ googleClass, guestClass }: { googleClass: string; guestClass: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState<null | 'google' | 'guest'>(null);
  const [error, setError] = useState<string | null>(null);
  const callbackError = searchParams.get('error');

  async function continueWithGoogle(): Promise<void> {
    setBusy('google');
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const { data: sessionData } = await supabase.auth.getSession();
      const redirectTo = `${window.location.origin}/auth/callback`;
      const res = sessionData.session
        ? await supabase.auth.linkIdentity({ provider: 'google', options: { redirectTo } })
        : await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
      if (res.error) {
        setError('Google sign-in did not start. Try again.');
        setBusy(null);
        return;
      }
      const url = (res.data as { url?: string } | null)?.url;
      if (url) window.location.assign(url);
      // Otherwise the client is already redirecting; stay busy.
    } catch {
      setError('Google sign-in did not start. Try again.');
      setBusy(null);
    }
  }

  async function continueAsGuest(): Promise<void> {
    setBusy('guest');
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const { error: signInError } = await supabase.auth.signInAnonymously();
      if (signInError) {
        setError('Guest sign-in did not start. Try again.');
        setBusy(null);
        return;
      }
      router.push('/app');
    } catch {
      setError('Guest sign-in did not start. Try again.');
      setBusy(null);
    }
  }

  return (
    <>
      <button type="button" className={googleClass} onClick={() => void continueWithGoogle()} disabled={busy !== null}>
        {busy === 'google' ? 'Connecting…' : 'Continue with Google'}
      </button>
      <button type="button" className={guestClass} onClick={() => void continueAsGuest()} disabled={busy !== null}>
        {busy === 'guest' ? 'Connecting…' : 'Look around as a guest'}
      </button>
      {callbackError && !error ? (
        <p role="alert" style={{ marginTop: 8, fontSize: 13 }}>
          Sign-in did not finish. Please try again.
        </p>
      ) : null}
      {error ? (
        <p role="alert" style={{ marginTop: 8, fontSize: 13 }}>
          {error}
        </p>
      ) : null}
    </>
  );
}
