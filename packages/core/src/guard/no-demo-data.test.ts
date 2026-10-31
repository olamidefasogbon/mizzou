import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Non-negotiable (PROMPT.md section 2): the app starts fresh. No hardcoded
// demo data anywhere in app code. Test data lives only in tests, fixtures
// and the eval. This test scans the shipped sources and fails on the known
// demo strings. Keep the banned list in sync with the audit table.

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');

const SCAN_DIRS = ['apps/web/src', 'packages/core/src'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'fixtures']);
const SKIP_FILES = [/\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/, /^\.tmp-/, /^guard-.*\.test\.[jt]sx?$/];

// Legitimate chat-group interface labels, not demo data. Stripped by exact
// string before scanning so the pill rule never flags panel group headers.
const ALLOWLISTED_LABELS = ['Today', 'Yesterday', 'Previous 7 days', 'Older'];

const BANNED: Array<{ label: string; pattern: RegExp }> = [
  { label: 'hardcoded first name', pattern: /\bJohn\b/ },
  { label: 'hardcoded program', pattern: /Fulbright/ },
  { label: 'hardcoded school', pattern: /\bYale\b/ },
  { label: 'hardcoded program', pattern: /Chevening/ },
  // Fake reminder pills hardcode a bare day count as the whole pill value.
  { label: 'hardcoded day-count pill', pattern: /['"`]\d+\s+days?['"`]/ },
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) yield* walk(full);
    } else if (!SKIP_FILES.some((re) => re.test(entry))) {
      yield full;
    }
  }
}

describe('no hardcoded demo data in app code', () => {
  it('ships no names, programs or day counts outside tests/fixtures', () => {
    const hits: string[] = [];
    for (const rel of SCAN_DIRS) {
      for (const file of walk(join(ROOT, rel))) {
        let text = readFileSync(file, 'utf-8');
        for (const label of ALLOWLISTED_LABELS) text = text.split(label).join('');
        for (const { label, pattern } of BANNED) {
          if (pattern.test(text)) hits.push(`${file.replace(ROOT + '/', '')}: ${label}`);
        }
      }
    }
    expect(hits, `demo data in app code:\n${hits.join('\n')}`).toEqual([]);
  });
});
