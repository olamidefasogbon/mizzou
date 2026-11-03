// Matches CONTINUE_TEXT in @mizzou/core/voice (kept as a literal so this file
// stays free of the core import; voice.test.ts pins both).
const CONTINUE_PREFIX = 'Carry on with the work you were doing.';

// Rebuild the visible part of a chat from its stored runs. A run keeps the
// full model history (tool results, gate decisions, ...); only the plain
// user and assistant text lines are shown again when a chat is reopened.
// Cards (requirements, plan, fit) are not rebuilt here.

export interface HistoryLine {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatHistory {
  /** The latest run of the chat, so a follow-up continues it. Null when none. */
  runId: string | null;
  lines: HistoryLine[];
}

export function visibleLines(messages: unknown[]): HistoryLine[] {
  const out: HistoryLine[] = [];
  for (const m of messages) {
    if (typeof m !== 'object' || m === null) continue;
    const { role, text } = m as { role?: unknown; text?: unknown };
    if ((role === 'user' || role === 'assistant') && typeof text === 'string' && text.trim() !== '') {
      // Gate answers are stored as plain user lines for the model ("The user
      // answered G1: {...}"). They are plumbing, never something the person typed.
      if (role === 'user' && (/^The user answered /.test(text) || text.startsWith(CONTINUE_PREFIX))) continue;
      out.push({ role, text });
    }
  }
  return out;
}
