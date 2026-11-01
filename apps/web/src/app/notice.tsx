'use client';

import { CircleAlert, Info, X } from 'lucide-react';
import styles from './notice.module.css';

export function Notice({
  tone = 'error',
  floating = false,
  onDismiss,
  children,
}: {
  tone?: 'error' | 'info';
  floating?: boolean;
  onDismiss?: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const Icon = tone === 'error' ? CircleAlert : Info;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`${styles.notice} ${styles[tone]} ${floating ? styles.floating : ''}`}
    >
      <Icon className={styles.icon} aria-hidden="true" />
      <span className={styles.text}>{children}</span>
      {onDismiss ? (
        <button type="button" className={styles.close} onClick={onDismiss} aria-label="Dismiss">
          <X className={styles.closeIcon} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
