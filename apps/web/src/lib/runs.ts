import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileRunStore } from '@mizzou/core';

// Superseded by lib/repo.ts (Part A step 4): routes resolve runs through
// the Repo now. Kept for reference; the file-backed era lives in repo's
// fileRunLedger.
export function runsStore(): FileRunStore {
  return new FileRunStore(join(process.env.MIZZOU_DATA_DIR ?? join(tmpdir(), 'mizzou'), 'runs'));
}
