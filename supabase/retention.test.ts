// Retention query contract: the cleanup deletes ONLY idle anonymous
// users (7-day window), via cascade, as a security-definer function.
// Run: node --test supabase/retention.test.ts (from the repo root).
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('./migrations/0004_retention.sql', import.meta.url), 'utf8');

describe('anonymous retention cleanup', () => {
  it('touches only anonymous users', () => {
    assert.match(sql, /is_anonymous = true/);
    assert.doesNotMatch(sql, /is_anonymous = false/);
  });

  it('waits a full 7 idle days', () => {
    assert.match(sql, /interval '7 days'/);
    assert.match(sql, /coalesce\(last_sign_in_at, created_at\)/);
  });

  it('deletes through auth.users so owned rows cascade', () => {
    assert.match(sql, /delete from auth\.users/);
  });

  it('runs as a security-definer function returning the deleted count', () => {
    assert.match(sql, /security definer/);
    assert.match(sql, /returns integer/);
    assert.match(sql, /return removed/);
  });
});
