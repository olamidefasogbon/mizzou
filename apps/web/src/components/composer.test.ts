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
    assert.match(chromeSrc, /background:\s*canSend \? "var\(--mz-blue\)"/);
  });

  it('voice button is quiet: tokens only, mic icon at 1.75 stroke, editable transcript', () => {
    const voiceSrc = readFileSync(new URL('./voice-button.tsx', import.meta.url), 'utf8');
    assert.match(voiceSrc, /Mic size=\{20\} strokeWidth=\{1\.75\}/);
    assert.match(voiceSrc, /aria-label="Record a voice note"/);
    assert.match(voiceSrc, /onTranscript\(out\.transcript\)/);
    assert.doesNotMatch(voiceSrc, /#[0-9a-fA-F]{3,6}/);
    assert.match(chromeSrc, /<VoiceButton disabled=\{voice\.disabled\} onTranscript=\{voice\.onTranscript\} \/>/);
  });

  it('attach control is quiet: tokens only, lucide icon at 1.75 stroke', () => {
    assert.match(globalsCss, /\.mz-composer-attach\s*\{[^}]*color:\s*var\(--mz-secondary\)/);
    assert.match(globalsCss, /\.mz-composer-chip\s*\{[^}]*background:\s*var\(--mz-muted\)/);
    const attachSrc = readFileSync(new URL('./attach-button.tsx', import.meta.url), 'utf8');
    assert.match(attachSrc, /ImagePlus size=\{20\} strokeWidth=\{1\.75\}/);
    assert.match(attachSrc, /aria-label="Attach a flyer or screenshot"/);
    assert.doesNotMatch(attachSrc, /#[0-9a-fA-F]{3,6}/);
    assert.match(chromeSrc, /<AttachButton/);
  });

  it('send button is blue only when there is text (conversation)', () => {
    assert.match(convoSrc, /disabled=\{busy \|\| queued \|\| \(input\.trim\(\)\.length === 0 && !vision\)\}/);
    assert.match(convoCss, /\.sendBtn:disabled\s*\{[^}]*background:\s*var\(--mz-muted\)/);
  });
});
