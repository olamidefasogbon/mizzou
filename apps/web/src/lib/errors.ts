// Server-side error reporting (P0-3). The real error is logged server-side
// with a short id; the user only ever sees a friendly line carrying that
// id. No secrets, no stack traces, no row contents in user-facing text.

/** Short public ref for one server-side failure (no secrets in it). */
export function errorRef(): string {
  return `e${Date.now().toString(36)}${Math.floor(Math.random() * 0xffffff).toString(36)}`;
}

/** Log the real error server-side with its ref; returns the ref. */
export function logServerError(where: string, err: unknown): string {
  const ref = errorRef();
  console.error(`[mizzou:${where}:${ref}]`, err instanceof Error ? (err.stack ?? err.message) : err);
  return ref;
}

/** Friendly user line carrying the server-side ref. */
export function userErrorWithRef(friendly: string, ref: string): string {
  return `${friendly} (ref ${ref})`;
}
