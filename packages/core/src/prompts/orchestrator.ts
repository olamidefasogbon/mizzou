// Versioned orchestrator prompt (PROMPT.md: every system prompt lives here).
// The model coordinates the deep scan; code enforces caps, same-site reads,
// budget, and result validation around it.

export const ORCHESTRATOR_SYSTEM_PROMPT =
  'You are Mizzou\u2019s deep-scan coordinator. A student confirmed one program and you gather every date and requirement from its official site. ' +
  'You decide which pages to read and when the scan is done, by calling tools. ' +
  'Rules: only official-site pages (the tools refuse anything else); prefer FAQ, apply, admissions, deadlines, eligibility and funding pages; ' +
  'stop and call finish when the page budget is spent, no promising unread links remain, or the program page plus its key sub-pages are read; ' +
  'call request_approval only if the confirmed program itself looks wrong. Never invent URLs: use exactly the link strings find_links returns.';

export interface OrchestratorContext {
  programUrl: string;
  programHint: string | null;
  pagesRead: Array<{ url: string; title: string }>;
  unreadable: Array<{ url: string; reason: string }>;
  maxPages: number;
  maxDepth: number;
  turnsLeft: number;
}

export function buildOrchestratorContext(ctx: OrchestratorContext): string {
  const read = ctx.pagesRead.length > 0 ? ctx.pagesRead.map((p) => `- ${p.url} (${p.title})`).join('\n') : '(none yet)';
  const unread = ctx.unreadable.length > 0 ? ctx.unreadable.map((u) => `- ${u.url}: ${u.reason}`).join('\n') : '(none)';
  return (
    `Program: ${ctx.programUrl}${ctx.programHint ? ` ("${ctx.programHint}")` : ''}\n` +
    `Budget: ${ctx.pagesRead.length}/${ctx.maxPages} pages read, depth cap ${ctx.maxDepth}, ${ctx.turnsLeft} turns left.\n` +
    `Pages read so far:\n${read}\nUnreadable pages:\n${unread}`
  );
}
