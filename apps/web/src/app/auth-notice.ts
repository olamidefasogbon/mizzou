// Turns the ways a Google sign-in can come back unfinished into one calm
// sentence. Supabase reports some failures in the URL hash (not visible to
// the server), others in the query string, and our own callback sends
// ?error=<code>. Pure so it is testable without a browser.

export interface AuthNotice {
  tone: 'error' | 'info';
  text: string;
}

const GENERIC: AuthNotice = { tone: 'error', text: 'Google sign-in did not finish. Try again in a moment' };

function parse(part: string): URLSearchParams {
  return new URLSearchParams(part.replace(/^[?#]/, ''));
}

export function authNotice(search: string, hash: string, fallback?: string | null): AuthNotice | null {
  const q = parse(search);
  const h = parse(hash);
  const code = h.get('error_code') ?? q.get('error_code') ?? fallback ?? q.get('error') ?? h.get('error');
  if (!code) return null;
  if (code === 'identity_already_exists') {
    return { tone: 'info', text: 'That Google account already has a Mizzou account. Choose Log in to open it' };
  }
  if (code === 'access_denied') {
    return { tone: 'info', text: 'Google sign-in was cancelled. Choose Log in to try again' };
  }
  return GENERIC;
}
