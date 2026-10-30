'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

// Sign-up button. Google OAuth only: signup and login are the same flow —
// Google creates the account on first sign-in, returning users just sign in.

export function SignupActions({ googleClass }: { googleClass: string }) {
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const callbackError = searchParams.get('error');

  async function continueWithGoogle(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const redirectTo = `${window.location.origin}/auth/callback`;
      const res = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
      if (res.error) {
        setError('Google sign-in did not start. Try again.');
        setBusy(false);
        return;
      }
      const url = (res.data as { url?: string } | null)?.url;
      if (url) window.location.assign(url);
      // Otherwise the client is already redirecting; stay busy.
    } catch {
      setError('Google sign-in did not start. Try again.');
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={googleClass} onClick={() => void continueWithGoogle()} disabled={busy}>
        {busy ? 'Connecting…' : 'Continue with Google'}
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
