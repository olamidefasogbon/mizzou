'use client';

import { useEffect, useRef } from 'react';

// Cloudflare Turnstile widget for anonymous session creation. Renders
// nothing — and reports a null token — when NEXT_PUBLIC_TURNSTILE_SITE_KEY
// is unset, so local and preview environments skip silently. When set, the
// parent passes the verified token as the captchaToken to
// signInAnonymously (Supabase validates it when captcha is enforced).

declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void }): string;
      remove(id: string): void;
    };
  }
}

const SCRIPT_ID = 'mizzou-turnstile-api';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

export function Turnstile({ onToken }: { onToken: (token: string | null) => void }): React.JSX.Element | null {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const ref = useRef<HTMLDivElement | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!siteKey) {
      onTokenRef.current(null);
      return;
    }
    let widgetId: string | undefined;
    let cancelled = false;
    const render = (): void => {
      if (cancelled || !ref.current || !window.turnstile) return;
      widgetId = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        callback: (token: string) => onTokenRef.current(token),
      });
    };
    if (window.turnstile) {
      render();
    } else if (!document.getElementById(SCRIPT_ID)) {
      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = render;
      document.head.appendChild(script);
    } else {
      document.getElementById(SCRIPT_ID)?.addEventListener('load', render, { once: true });
      if (window.turnstile) render();
    }
    return () => {
      cancelled = true;
      if (widgetId !== undefined) window.turnstile?.remove(widgetId);
    };
  }, [siteKey]);

  if (!siteKey) return null;
  return <div ref={ref} />;
}
