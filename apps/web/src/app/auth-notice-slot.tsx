'use client';

import { useEffect, useState } from 'react';
import { authNotice, type AuthNotice } from './auth-notice';
import { Notice } from './notice';
import styles from './landing.module.css';

// Shows why a Google sign-in came back unfinished. The server passes the
// ?error code so the first paint is right; the effect then also reads the
// URL hash (where Supabase puts some errors) and cleans the address bar so
// a refresh does not show the message again.
export function AuthNoticeSlot({ serverError }: { serverError?: string }): React.JSX.Element | null {
  const [notice, setNotice] = useState<AuthNotice | null>(() => authNotice('', '', serverError ?? null));

  useEffect(() => {
    const next = authNotice(window.location.search, window.location.hash, serverError ?? null);
    if (next) setNotice(next);
    if (window.location.search || window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, [serverError]);

  if (!notice) return null;
  return (
    <div className={styles.noticeSlot}>
      <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>
        {notice.text}
      </Notice>
    </div>
  );
}
