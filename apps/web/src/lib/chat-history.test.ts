// Run: node --test src/lib/chat-history.test.ts (from apps/web).
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { visibleLines } from './chat-history.ts';

describe('visibleLines', () => {
  it('keeps user and assistant text, drops tool results and blanks', () => {
    const out = visibleLines([
      { role: 'user', text: 'hi' },
      { role: 'tool_result', gate: 'G1', decision: 'yes' },
      { role: 'assistant', text: 'Found it.' },
      { role: 'assistant', text: '   ' },
      { type: 'message', role: 'user', content: [] },
      null,
      'x',
    ]);
    assert.deepEqual(out, [
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'Found it.' },
    ]);
  });

  it('hides the gate answers stored as user lines', () => {
    const out = visibleLines([
      { role: 'user', text: 'is this real?' },
      { role: 'user', text: 'The user answered G1: {"confirmed":true}' },
      { role: 'assistant', text: 'Yes.' },
    ]);
    assert.deepEqual(out, [
      { role: 'user', text: 'is this real?' },
      { role: 'assistant', text: 'Yes.' },
    ]);
  });
});
