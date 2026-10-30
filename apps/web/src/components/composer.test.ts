// Run: node --test src/components/composer.test.ts (from apps/web).
// P2-15 is pure styling, so this suite pins the contract in source: no inner
// input ring, 1px Meta Blue pill border on focus-within, blue send button
// only when there is text. Pixel checks are browser sign-off.
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

const convoCss = readFileSync(new URL('../app/app/c/[chatId]/conversation.module.css', import.meta.url), 'utf8');
const globalsCss = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const chromeSrc = readFileSync(new URL('./chrome.tsx', import.meta.url), 'utf8');
const convoSrc = readFileSync(new URL('../app/app/c/[chatId]/page.tsx', import.meta.url), 'utf8');

describe('composer (P2-15)', () => {
  it('conversation pill takes a 1px Meta Blue border on focus-within', () => {
    assert.match(convoCss, /\.composer:focus-within\s*\{\s*border-color:\s*var\(--mz-blue\);\s*\}/);
  });

  it('conversation input never draws an inner ring', () => {
    assert.match(convoCss, /\.composerInput:focus-visible\s*\{\s*box-shadow:\s*none;\s*\}/);
  });

  it('shared composer pill takes a 1px Meta Blue border on focus-within', () => {
    assert.match(globalsCss, /\.mz-composer-pill:focus-within\s*\{\s*border-color:\s*var\(--mz-blue\);\s*\}/);
    assert.match(chromeSrc, /className="mz-composer-pill"/);
  });

  it('shared composer input never draws an inner ring', () => {
    assert.match(globalsCss, /\.mz-composer-input:focus-visible\s*\{\s*box-shadow:\s*none;\s*\}/);
    assert.match(chromeSrc, /className="mz-composer-input"/);
  });

  it('send button is blue only when there is text (shared composer)', () => {
    assert.match(chromeSrc, /background:\s*hasText \? "var\(--mz-blue\)"/);
  });

  it('send button is blue only when there is text (conversation)', () => {
    assert.match(convoSrc, /disabled=\{busy \|\| input\.trim\(\)\.length === 0\}/);
    assert.match(convoCss, /\.sendBtn:disabled\s*\{[^}]*background:\s*var\(--mz-muted\)/);
  });
});
