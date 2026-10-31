// Fit card contract (M5, PROMPT.md 7.2): the chat page holds the fit card
// behind the G1 gate, releases it on confirm before the requirements card,
// and renders plain words only — never a score, percentage or /100. The two
// buttons post their voice-constant labels as chat messages so the turn
// records the decision once in decisions.
// Run: node --test src/app/app/chat-page.test.ts (from apps/web).
// (Lives here instead of next to page.tsx because node --test cannot glob
// the [chatId] segment.) Rendering pixels and the live turn are human
// browser + live-URL checks.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./c/[chatId]/page.tsx', import.meta.url), 'utf8');

describe('fit card contract', () => {
  it('defines a number-free fit payload', () => {
    assert.match(src, /interface FitPayload/);
    const block = src.slice(src.indexOf('interface FitPayload'), src.indexOf('interface FitPayload') + 400);
    assert.doesNotMatch(block, /score/);
    assert.match(block, /lines_up/);
    assert.match(block, /biggest_risk/);
  });

  it('holds fit cards behind the G1 gate and releases them on confirm', () => {
    assert.match(src, /kind === 'fit'/);
    assert.match(src, /pendingCards\?\.fit/);
    assert.match(src, /kind: 'fit',\s+fit: pendingCards\.fit/);
  });

  it('renders plain words with the voice labels and posts them back as answers', () => {
    assert.match(src, /fit\.title/);
    assert.match(src, /fit\.question/);
    assert.match(src, /FIT_APPLY_LABEL/);
    assert.match(src, /FIT_PARK_LABEL/);
    assert.match(src, /sendText\(choice === 'apply' \? FIT_APPLY_LABEL : FIT_PARK_LABEL\)/);
  });

  it('shows no score, percentage or /100 anywhere on the chat page', () => {
    assert.doesNotMatch(src, /\/100/);
    assert.doesNotMatch(src, /score/);
    assert.doesNotMatch(src, /[0-9]\s*%/);
  });
});

describe('draft card contract', () => {
  it('defines a versioned draft payload and renders draft cards', () => {
    assert.match(src, /interface DraftPayload/);
    assert.match(src, /kind === 'draft'/);
    assert.match(src, /Version \{draft\.version\}/);
  });

  it('shows the edit box and keep button, ending each draft at G5', () => {
    assert.match(src, /DRAFT_EDIT_PLACEHOLDER/);
    assert.match(src, /DRAFT_KEEP_LABEL/);
    assert.match(src, /gate: 'G5'/);
    assert.match(src, /decision: \{ kept: true/);
  });

  it('opens the pack from a settled chat', () => {
    assert.match(src, /PACK_OPEN_LABEL/);
    assert.match(src, /<PackOverlay pack=\{pack\} onClose/);
  });
});
