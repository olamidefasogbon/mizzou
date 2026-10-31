// Pack overlay contract (M6, PROMPT.md 7.6): checklist with tick-off
// rows, copy-ready answers and ready-to-send emails with word counts and
// Copy buttons, "check against the portal" marks on unconfirmed rows, and
// the portal button — all inside the overlay system (bottom sheet mobile,
// right sheet tablet, floating card desktop, Esc/scrim close).
// Run: node --test src/components/pack-overlay.test.ts (from apps/web).
// Pixels and the live draft/edit/keep flow are human browser checks.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tsx = readFileSync(new URL('./pack-overlay.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./pack-overlay.module.css', import.meta.url), 'utf8');

describe('pack overlay contract', () => {
  it('covers the four pack parts', () => {
    assert.match(tsx, /Checklist/);
    assert.match(tsx, /Copy-ready answers/);
    assert.match(tsx, /Ready-to-send emails/);
    assert.match(tsx, /Open the application page/);
  });

  it('shows word counts with copy buttons and marks unconfirmed rows', () => {
    assert.match(tsx, /wordCount/);
    assert.match(tsx, /Copy/);
    assert.match(tsx, /CHECK_AGAINST_PORTAL/);
    assert.match(tsx, /words\{/);
  });

  it('closes on escape and scrim without moving the page', () => {
    assert.match(tsx, /Escape/);
    assert.match(css, /position: fixed/);
    assert.match(css, /z-index: 60/);
  });

  it('follows the overlay breakpoints and honors reduced motion', () => {
    assert.match(css, /min-width: 768px/);
    assert.match(css, /min-width: 1100px/);
    assert.match(css, /prefers-reduced-motion/);
  });
});
