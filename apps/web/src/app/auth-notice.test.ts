// Run: node --test src/app/auth-notice.test.ts (from apps/web).
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { authNotice } from './auth-notice.ts';

describe('authNotice', () => {
  it('says nothing when the URL carries no error', () => {
    assert.equal(authNotice('', ''), null);
  });

  it('explains an account that already exists, even behind our own missing-code redirect', () => {
    const n = authNotice(
      '?error=missing-code',
      '#error=server_error&error_code=identity_already_exists&error_description=Identity+already+linked',
    );
    assert.equal(n?.tone, 'info');
    assert.match(n?.text ?? '', /already has a Mizzou account/);
  });

  it('accepts the code from our callback redirect', () => {
    assert.match(authNotice('?error=identity_already_exists', '')?.text ?? '', /already has a Mizzou account/);
  });

  it('treats a cancelled consent screen as informational', () => {
    assert.equal(authNotice('', '#error=access_denied&error_code=access_denied')?.tone, 'info');
  });

  it('falls back to one friendly line for anything else, never raw provider text', () => {
    const n = authNotice('?error=oauth', '');
    assert.equal(n?.tone, 'error');
    assert.doesNotMatch(n?.text ?? '', /oauth|server_error/i);
  });
});
