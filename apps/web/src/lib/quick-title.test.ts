import test from 'node:test';
import assert from 'node:assert/strict';
import { quickTitle } from './quick-title.ts';

test('a link becomes its site and page', () => {
  assert.equal(quickTitle('https://inf.ethz.ch/studies/summer-research-fellowship/how-to-apply.html'), 'Inf.ethz.ch how to apply');
});
test('plain text becomes its first words', () => {
  assert.equal(quickTitle('im intrested in the Boren fellowship for next year please'), 'Im intrested in the Boren');
});
test('empty is New chat', () => {
  assert.equal(quickTitle('   '), 'New chat');
});
