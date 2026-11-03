'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { ensureAnonymousSession } from '@/lib/anonymous';
import { Turnstile } from './turnstile';
import { Notice } from './notice';
import styles from './landing.module.css';

// Landing entry points. No signup required: "Try it for free" ensures an
// anonymous session silently and opens /app. "Log in" is only for
// returning users: plain Google OAuth that signs them in as the account
// they already have (linking would fail for an account that exists). A
// first-time visitor's guest chats stay on the guest; upgrading in place
// lives in Settings.

function failure(friendly: string, detail: string): string {
  // TEMPORARY: show the provider message in production too until sign-in is confirmed working.
  return `${friendly} (${detail.slice(0, 140)})`;
}

export function TryButton({ className }: { className: string }) {
  const router = useRouter();
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  // null = not checked yet. The human check only mounts for visitors who
  // do not already have a session (the proxy usually mints one first).
  const [needsCheck, setNeedsCheck] = useState<boolean | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!siteKey) return;
    let live = true;
    supabaseBrowser()
      .auth.getSession()
      .then(({ data }: { data: { session: unknown } }) => {
        if (live) setNeedsCheck(!data.session);
      })
      .catch(() => {
        if (live) setNeedsCheck(true);
      });
    return () => {
      live = false;
    };
  }, [siteKey]);

  const start = useCallback(
    async (captcha: string | null): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await ensureAnonymousSession(supabaseBrowser().auth, captcha ?? undefined);
        router.push('/app');
      } catch (err) {
        setError(failure('Could not start. Try again in a moment', err instanceof Error ? err.message : String(err)));
        setToken(null);
        setAttempt((a) => a + 1); // tokens are single use: fresh check next time
        setBusy(false);
      }
    },
    [router],
  );

  // The visitor tapped before the check finished: carry on as soon as it does.
  useEffect(() => {
    if (waiting && token) {
      setWaiting(false);
      void start(token);
    }
  }, [waiting, token, start]);

  // A hidden check can stall. After a few seconds try without a token (works
  // when captcha is not enforced), then show the check so the visitor can
  // finish it, and after a longer wait say what to do.
  useEffect(() => {
    if (!waiting) return;
    const t1 = setTimeout(() => {
      void (async () => {
        try {
          await ensureAnonymousSession(supabaseBrowser().auth, undefined);
          router.push('/app');
          setWaiting(false);
        } catch {
          setVisible(true);
          setAttempt((a) => a + 1);
          setError('One more step: finish the check below and I will take you in');
        }
      })();
    }, 8000);
    const t2 = setTimeout(() => {
      setWaiting(false);
      setError('The check is not finishing. Refresh the page or try another browser, then tap Try it for free again');
    }, 35000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [waiting, router]);

  async function onClick(): Promise<void> {
    if (busy || waiting) return;
    setError(null);
    if (siteKey && !token) {
      const { data } = await supabaseBrowser().auth.getSession();
      if (!data.session) {
        setNeedsCheck(true);
        setWaiting(true);
        return;
      }
    }
    await start(token);
  }

  function onCheckFailed(): void {
    setWaiting(false);
    setError('The security check did not load. Check your connection and try again');
    setAttempt((a) => a + 1);
  }

  return (
    <div className={styles.tryWrap}>
      <button type="button" className={className} onClick={() => void onClick()} disabled={busy || waiting}>
        {busy ? 'Starting…' : waiting ? 'Checking…' : 'Try it for free'}
      </button>
      {siteKey && needsCheck ? <Turnstile key={attempt} visible={visible} onToken={setToken} onError={onCheckFailed} /> : null}
      {error ? <Notice onDismiss={() => setError(null)}>{error}</Notice> : null}
    </div>
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
      const redirectTo = `${window.location.origin}/auth/callback`;
      const res = await supabaseBrowser().auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
      if (res.error) {
        setError(failure('Google sign-in did not start. Try again', res.error.message));
        setBusy(false);
        return;
      }
      const url = (res.data as { url?: string } | null)?.url;
      if (url) window.location.assign(url);
      // Otherwise the client is already redirecting; stay busy.
    } catch (err) {
      setError(failure('Google sign-in did not start. Try again', err instanceof Error ? err.message : String(err)));
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={() => void login()} disabled={busy}>
        {busy ? 'Connecting…' : 'Log in'}
      </button>
      {error ? (
        <Notice floating onDismiss={() => setError(null)}>
          {error}
        </Notice>
      ) : null}
    </>
  );
}
