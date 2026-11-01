'use client';

import { useEffect, useRef } from 'react';
import styles from './turnstile.module.css';

// Cloudflare Turnstile widget for anonymous session creation. Renders
// nothing — and reports a null token — when NEXT_PUBLIC_TURNSTILE_SITE_KEY
// is unset, so local and preview environments skip silently. When set, the
// parent passes the verified token as the captchaToken to
// signInAnonymously (Supabase validates it when captcha is enforced).
// Runs in interaction-only mode: the check solves itself in the background
// and only appears if the visitor has to tap something.

interface TurnstileOptions {
  sitekey: string;
  theme: 'light' | 'dark' | 'auto';
  size: 'normal' | 'flexible' | 'compact';
  appearance: 'always' | 'execute' | 'interaction-only';
  retry: 'auto' | 'never';
  'refresh-expired': 'auto' | 'manual';
  callback: (token: string) => void;
  'error-callback': () => boolean | void;
  'expired-callback': () => void;
  'timeout-callback': () => void;
}

declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, opts: TurnstileOptions): string;
      remove(id: string): void;
    };
  }
}

const SCRIPT_ID = 'mizzou-turnstile-api';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export function Turnstile({
  onToken,
  onError,
}: {
  onToken: (token: string | null) => void;
  onError?: () => void;
}): React.JSX.Element | null {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const ref = useRef<HTMLDivElement | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!siteKey) {
      onTokenRef.current(null);
      return;
    }
    let widgetId: string | undefined;
    let cancelled = false;
    const render = (): void => {
      if (cancelled || !ref.current || !window.turnstile || widgetId !== undefined) return;
      widgetId = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        theme: 'light',
        size: 'flexible',
        appearance: 'interaction-only',
        retry: 'auto',
        'refresh-expired': 'auto',
        callback: (token: string) => onTokenRef.current(token),
        // Returning true tells Turnstile the error is handled, so it stays
        // out of the console; the parent shows one friendly line instead.
        'error-callback': () => {
          onTokenRef.current(null);
          onErrorRef.current?.();
          return true;
        },
        'expired-callback': () => onTokenRef.current(null),
        'timeout-callback': () => onTokenRef.current(null),
      });
    };
    const existing = document.getElementById(SCRIPT_ID);
    if (window.turnstile) {
      render();
    } else if (!existing) {
      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = render;
      script.onerror = () => onErrorRef.current?.();
      document.head.appendChild(script);
    } else {
      existing.addEventListener('load', render, { once: true });
    }
    return () => {
      cancelled = true;
      if (widgetId !== undefined) window.turnstile?.remove(widgetId);
    };
  }, [siteKey]);

  if (!siteKey) return null;
  return <div ref={ref} className={styles.captcha} />;
}
