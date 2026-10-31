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
      out.push({ role, text });
    }
  }
  return out;
}
