// Run: node --test src/components/panel.test.ts (from apps/web).
// Panel footer contract: guests see a Guest row with a Google upgrade
// button (linkIdentity keeps their rows); signed-in users see name/email.
// The upgrade itself is unit-tested in google-upgrade.test.ts; the dialog
// and OAuth redirect are browser sign-off items.
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./panel.tsx', import.meta.url), 'utf8');

describe('panel footer contract', () => {
  it('shows Guest with a save-through-Google button for guests', () => {
    assert.match(src, /isGuest/);
    assert.match(src, />Guest</);
    assert.match(src, /Save your chats, continue with Google/);
    assert.match(src, /upgradeToGoogle/);
  });

  it('keeps name and email for signed-in users', () => {
    assert.match(src, /\{name \?\? email \?\? 'Signed in'\}/);
    assert.match(src, /\{email \?\? 'Signed in with Google'\}/);
  });
});
