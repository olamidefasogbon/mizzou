// Google upgrade flow: linkIdentity keeps the anonymous user id, so chats
// and reminders carry over. Mocked auth client, no network, no keys.
// Run: node --test src/components/google-upgrade.test.ts (from apps/web).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { upgradeToGoogle, type LinkAuth } from './google-upgrade.ts';

function mockAuth(result: { url?: string; message?: string }, seen: unknown[]): LinkAuth {
  return {
    linkIdentity: async (args: { provider: 'google'; options: { redirectTo: string } }) => {
      seen.push(args);
      if (result.message) return { data: null, error: { message: result.message } };
      return { data: result.url === undefined ? null : { url: result.url }, error: null };
    },
  };
}

describe('upgradeToGoogle', () => {
  it('links the Google identity and returns the OAuth url', async () => {
    const seen: unknown[] = [];
    const out = await upgradeToGoogle(mockAuth({ url: 'https://accounts.google/x' }, seen), 'https://mizzou.app');
    assert.deepEqual(out, { url: 'https://accounts.google/x' });
    assert.deepEqual(seen, [{ provider: 'google', options: { redirectTo: 'https://mizzou.app/auth/callback' } }]);
  });

  it('returns a friendly error when linking fails', async () => {
    const out = await upgradeToGoogle(mockAuth({ message: 'linking denied' }, []), 'https://mizzou.app');
    assert.deepEqual(out, { error: 'Google sign-in did not start. Try again.' });
  });

  it('returns a friendly error when no url comes back', async () => {
    const out = await upgradeToGoogle(mockAuth({}, []), 'https://mizzou.app');
    assert.deepEqual(out, { error: 'Google sign-in did not start. Try again.' });
  });
});
