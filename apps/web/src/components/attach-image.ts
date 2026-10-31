// Client-side flyer/screenshot attach (home + chat composers). The browser
// downscales to 1600px on the long side before sending (PROMPT.md 4);
// the server enforces size, magic-byte type and rate/count caps, then the
// vision role reads the image. No core imports: this module runs in the
// browser, where server-only core entry points are unavailable.
export interface VisionPayload {
  id: string;
  name: string;
  extraction: unknown;
}

/** Downscale to 1600px on the long side, JPEG data URL for the wire. */
export async function downscaleImage(file: File, maxSide = 1600, quality = 0.85): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxSide / Math.max(1, Math.max(bitmap.width, bitmap.height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available in this browser.');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    bitmap.close();
  }
}

/** POST one downscaled image to /api/upload. Throws the friendly message. */
export async function uploadImage(dataUrl: string, name: string): Promise<VisionPayload> {
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl, name }),
  });
  const data = (await res.json()) as { uploadId?: unknown; name?: unknown; extraction?: unknown; error?: unknown };
  if (!res.ok || typeof data.uploadId !== 'string' || !data.extraction) {
    throw new Error(typeof data.error === 'string' ? data.error : 'I could not read that image. Try again in a moment.');
  }
  return { id: data.uploadId, name: typeof data.name === 'string' ? data.name : name, extraction: data.extraction };
}

const keyFor = (chatId: string): string => `mz:vision:${chatId}`;

/** Stash an upload for the home -> chat handoff (?q=). Consumed once. */
export function stashVision(chatId: string, payload: VisionPayload[]): void {
  try {
    sessionStorage.setItem(keyFor(chatId), JSON.stringify(payload));
  } catch {
    // Private mode: the chat still works, just without the attachment.
  }
}

/** Read and clear the stashed upload for this chat, if any. */
export function takeStashedVision(chatId: string): VisionPayload[] | null {
  try {
    const raw = sessionStorage.getItem(keyFor(chatId));
    if (!raw) return null;
    sessionStorage.removeItem(keyFor(chatId));
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const out: VisionPayload[] = [];
    for (const item of parsed) {
      const v = item as { id?: unknown; name?: unknown; extraction?: unknown };
      if (typeof v.id === 'string' && typeof v.name === 'string' && v.extraction) {
        out.push({ id: v.id, name: v.name, extraction: v.extraction });
      }
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}
