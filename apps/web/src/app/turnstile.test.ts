// Turnstile contract: the widget renders only when a site key is set, and
// the landing passes the verified token into anonymous session creation.
// DOM rendering is a browser sign-off item; the contract is pinned in
// source. Token plumbing itself is covered in lib/anonymous.test.ts.
// Run: node --test src/app/turnstile.test.ts (from apps/web).
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

const widget = readFileSync(new URL('./turnstile.tsx', import.meta.url), 'utf8');
const landing = readFileSync(new URL('./landing-actions.tsx', import.meta.url), 'utf8');

describe('turnstile contract', () => {
  it('renders nothing and reports null when no site key is set', () => {
    assert.match(widget, /NEXT_PUBLIC_TURNSTILE_SITE_KEY/);
    assert.match(widget, /if \(!siteKey\) return null/);
    assert.match(widget, /onTokenRef\.current\(null\)/);
  });

  it('landing gates Try on the token only when a key is set, then passes it through', () => {
    assert.match(landing, /<Turnstile onToken=\{setToken\} \/>/);
    assert.match(landing, /if \(siteKey && !token\)/);
    assert.match(landing, /ensureAnonymousSession\(supabaseBrowser\(\)\.auth, token \?\? undefined\)/);
  });
});
