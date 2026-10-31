// Anonymous session helper: an existing session is reused silently, a
// missing one is minted with signInAnonymously, mint failures throw the
// provider message. Mocked auth client, no network, no keys.
// Run: node --test src/lib/anonymous.test.ts (from apps/web).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ensureAnonymousSession, type AnonymousAuth } from './anonymous.ts';

function mockAuth(session: unknown, anonError: { message: string } | null = null): AnonymousAuth & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    getSession: async () => ({ data: { session } }),
    signInAnonymously: async (options?: { options?: { captchaToken?: string } }) => {
      calls.push(options);
      return { error: anonError };
    },
  };
}

describe('ensureAnonymousSession', () => {
  it('reuses an existing session without minting', async () => {
    const auth = mockAuth({ user: { id: 'u1' } });
    assert.equal(await ensureAnonymousSession(auth), 'existing');
    assert.equal(auth.calls.length, 0);
  });

  it('mints an anonymous session when none exists', async () => {
    const auth = mockAuth(null);
    assert.equal(await ensureAnonymousSession(auth), 'created');
    assert.equal(auth.calls.length, 1);
    assert.deepEqual(auth.calls[0], undefined);
  });

  it('passes a Turnstile captcha token through when given', async () => {
    const auth = mockAuth(null);
    assert.equal(await ensureAnonymousSession(auth, 'tok-123'), 'created');
    assert.deepEqual(auth.calls[0], { options: { captchaToken: 'tok-123' } });
  });

  it('throws the provider message when minting fails', async () => {
    const auth = mockAuth(null, { message: 'Anonymous sign-ins are disabled' });
    await assert.rejects(() => ensureAnonymousSession(auth), /Anonymous sign-ins are disabled/);
  });
});
