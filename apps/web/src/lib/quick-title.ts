// An instant chat name for the panel, before the model writes a better one.
// A link becomes its site and page, plain text becomes its first few words.

function cap(word: string): string {
  return word.length > 0 ? word[0]!.toUpperCase() + word.slice(1) : word;
}

export function quickTitle(text: string): string {
  const raw = text.trim();
  const urlMatch = raw.match(/https?:\/\/[^\s)]+/i);
  const rest = raw.replace(/https?:\/\/[^\s)]+/gi, ' ').replace(/\s+/g, ' ').trim();
  const words = rest.split(' ').filter((w) => /[a-z0-9]/i.test(w));
  if (words.length >= 3) return cap(words.slice(0, 5).join(' ').replace(/[.,!?:;]+$/, '')).slice(0, 40);
  if (urlMatch) {
    try {
      const u = new URL(urlMatch[0]);
      const host = u.hostname.replace(/^www\./, '');
      const seg = u.pathname.split('/').filter(Boolean).pop() ?? '';
      const page = seg.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
      return cap(page ? `${host} ${page}` : host).slice(0, 40);
    } catch {
      // fall through
    }
  }
  const t = words.join(' ') || raw;
  return t.length > 0 ? cap(t.slice(0, 40)) : 'New chat';
}
