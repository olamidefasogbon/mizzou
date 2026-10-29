import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileRunStore } from '@mizzou/core';

// File-backed agent runs until Supabase is wired. Chat creates the run,
// resume continues it; both resolve here so the directory never diverges.
export function runsStore(): FileRunStore {
  return new FileRunStore(join(process.env.MIZZOU_DATA_DIR ?? join(tmpdir(), 'mizzou'), 'runs'));
}
