import 'server-only';

import { createHash } from 'node:crypto';

// Upload intake helpers (route: api/upload). PNG/JPEG/WebP only, checked by
// magic bytes — never by extension or client mime. Server-only.
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46];

export type UploadImageType = 'png' | 'jpeg' | 'webp';

/** Declared data-URL mime must be an image type; the bytes decide. */
export function parseImageDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!m) return null;
  try {
    const bytes = new Uint8Array(Buffer.from(m[2] as string, 'base64'));
    if (bytes.length === 0) return null;
    return { mime: m[1] as string, bytes };
  } catch {
    return null;
  }
}

/** Magic-byte sniffing: PNG, JPEG, or WebP (RIFF....WEBP). */
export function sniffImageType(bytes: Uint8Array): UploadImageType | null {
  const starts = (magic: number[]): boolean => magic.every((b, i) => bytes[i] === b);
  if (starts(PNG_MAGIC)) return 'png';
  if (starts(JPEG_MAGIC)) return 'jpeg';
  if (
    starts(RIFF_MAGIC) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }
  return null;
}

/** Deterministic upload id from the bytes (evidence source `upload:{id}`). */
export function uploadIdFromBytes(bytes: Uint8Array): string {
  return `upl-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}`;
}
