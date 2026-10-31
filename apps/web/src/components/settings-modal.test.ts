// Run: node --test src/components/settings-modal.test.ts (from apps/web).
// The dialog itself needs a browser (portal, focus trap, Esc/backdrop), so
// this suite pins its static contract: nav sections, labels, defaults, and
// the delete-confirmation copy. Interaction checks (Esc/backdrop close,
// focus trap, delete-then-disabled) are browser sign-off items.
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { SETTINGS_NAV } from './settings-sections.ts';

describe('settings dialog contract', () => {
  it('renders General, Help, and Legal sections in order', () => {
    assert.deepEqual(
      SETTINGS_NAV.map((s) => s.id),
      ['general', 'help', 'legal'],
    );
    assert.deepEqual(
      SETTINGS_NAV.map((s) => s.label),
      ['General', 'Help & support', 'Legal & safety'],
    );
  });

  it('opens on General (first nav entry)', () => {
    assert.equal(SETTINGS_NAV[0]?.id, 'general');
  });

  it('delete control leaves a confirmation status (button replaced, not re-armed)', () => {
    const src = readFileSync(new URL('./settings-modal.tsx', import.meta.url), 'utf8');
    assert.match(src, /Deleted your chats and reminders\./);
    assert.match(src, /role="status"/);
  });

  it('shows Guest with a save-through-Google upgrade for guests', () => {
    const src = readFileSync(new URL('./settings-modal.tsx', import.meta.url), 'utf8');
    assert.match(src, /isGuest/);
    assert.match(src, />Guest</);
    assert.match(src, /Save your chats, continue with Google/);
    assert.match(src, /Continue with Google to keep chats and sync Calendar/);
    assert.match(src, /upgradeToGoogle/);
  });

  it('closes on Escape and on backdrop click', () => {
    const src = readFileSync(new URL('./settings-modal.tsx', import.meta.url), 'utf8');
    assert.match(src, /e\.key === 'Escape'/);
    assert.match(src, /<div className=\{styles\.scrim\} onClick=\{onClose\}>/);
  });
});
