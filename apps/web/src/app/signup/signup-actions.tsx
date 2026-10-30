'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

// Sign-up button. Google OAuth only: signup and login are the same flow —
// Google creates the account on first sign-in, returning users just sign in.

// In development the real reason is appended so setup problems are visible;
// production shows only the friendly line.
function devDetail(friendly: string, detail: string): string {
  return process.env.NODE_ENV === 'production' ? friendly : `${friendly} (${detail})`;
}

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
        console.error('[signup] google sign-in error:', res.error);
        setError(devDetail('Google sign-in did not start. Try again.', res.error.message));
        setBusy(false);
        return;
      }
      const url = (res.data as { url?: string } | null)?.url;
      if (url) window.location.assign(url);
      // Otherwise the client is already redirecting; stay busy.
    } catch (err) {
      console.error('[signup] google sign-in threw:', err);
      setError(devDetail('Google sign-in did not start. Try again.', err instanceof Error ? err.message : String(err)));
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
