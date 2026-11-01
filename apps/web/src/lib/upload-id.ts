import { createHash } from 'node:crypto';

// Upload ids: the producer (/api/upload) and the consumer (/api/chat) must
// agree on the shape, so both live here. "upl-" plus 16 hex chars. Kept free
// of server-only so plain node:test can cross-check the two directions.
const UPLOAD_ID = /^upl-[0-9a-f]{16}$/;

/** Deterministic upload id from the bytes (evidence source `upload:{id}`). */
export function uploadIdFromBytes(bytes: Uint8Array): string {
  return `upl-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}`;
}

export function isUploadId(v: unknown): v is string {
  return typeof v === 'string' && UPLOAD_ID.test(v);
}
