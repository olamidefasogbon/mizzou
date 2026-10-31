// Run: node --test src/app/copy.test.ts (from apps/web).
// No signup required: landing Try opens /app on an anonymous session,
// Log in is Google-only for returning users (linking keeps their rows),
// and no /signup page or forced-Google step remains. Pages import
// next/*, so the contract is asserted in source.
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const landing = readFileSync(join(here, 'page.tsx'), 'utf8');
const actions = readFileSync(join(here, 'landing-actions.tsx'), 'utf8');
const callback = readFileSync(join(here, 'auth/callback/route.ts'), 'utf8');

describe('landing and entry copy (no signup)', () => {
  it('Try it for free opens /app on an anonymous session, never a signup page', () => {
    assert.ok(!existsSync(join(here, 'signup')), 'signup page still exists');
    assert.doesNotMatch(landing, /\/signup/);
    assert.match(actions, /ensureAnonymousSession/);
    assert.match(actions, /router\.push\('\/app'\)/);
  });

  it('Log in is Google for returning users, linking an existing session', () => {
    assert.match(actions, /linkIdentity/);
    assert.match(actions, /signInWithOAuth/);
    assert.match(actions, /Log in/);
  });

  it('callback lands linked users in /app with no signup detour', () => {
    assert.doesNotMatch(callback, /\/signup/);
    assert.match(callback, /\/app/);
  });

  it('landing never mentions guests or anonymous sessions', () => {
    assert.doesNotMatch(landing, /[Gg]uest/);
    assert.doesNotMatch(landing, /[Aa]nonymous/);
  });
});
