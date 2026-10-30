// Run: node --test src/app/copy.test.ts (from apps/web).
// P2-16: landing and sign-up copy — no guest entry point, Google is the only
// action. Pages import next/* and CSS, so the contract is asserted in source.
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

const landing = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
const signup = readFileSync(new URL('./signup/page.tsx', import.meta.url), 'utf8');
const signupActions = readFileSync(new URL('./signup/signup-actions.tsx', import.meta.url), 'utf8');
const callback = readFileSync(new URL('./auth/callback/route.ts', import.meta.url), 'utf8');

describe('landing and sign-up copy (P2-16)', () => {
  it('landing offers no guest entry point', () => {
    assert.doesNotMatch(landing, /[Gg]uest/);
    assert.doesNotMatch(landing, /[Aa]nonymous/);
  });

  it('landing Try-it and Log-in both go to /signup', () => {
    const hrefs = [...landing.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    const ctas = hrefs.filter((h) => h !== '/');
    assert.ok(ctas.length >= 2, `expected at least two CTAs, saw ${hrefs.join(', ')}`);
    for (const href of ctas) assert.equal(href, '/signup');
  });

  it('sign-up has Google as the only action', () => {
    assert.match(signupActions, /Continue with Google/);
    assert.doesNotMatch(signupActions, /[Gg]uest/);
    assert.doesNotMatch(signup, /[Gg]uest/);
  });

  it('callback documents the single Google flow (no linking flow)', () => {
    assert.doesNotMatch(callback, /anonymous/i);
    assert.match(callback, /Google OAuth \(the only sign-in flow\)/);
  });
});
