// Model-driven conversation turn (docs/design/AGENT_BRAIN.md sections 1-2).
// Every user message runs a model turn on the orchestrator role with the
// canonical prompt in prompts/orchestrator.md. There is no regex or URL
// branching on the message text: the model decides which tools to call
// (fetch_page, read_page, web_search, gates, ...) and when to finish.
// Server state (stored response id, program, pages, extraction) chains
// turns; usage is logged per model call so no turn ever costs $0 silently.

import { readFileSync } from 'node:fs';
import { callModel } from '../meta/callModel.js';
import {
  responsesCall,
  streamResponsesCall,
  type ResponsesCallResult,
  type ResponsesFunctionTool,
  type ResponsesItem,
  type StreamCallOptions,
} from '../meta/responses.js';
import { BudgetExceededError } from '../meta/budget.js';
import { ROLE_MODEL_MAP } from '../meta/registry.js';
import { fetchBytes, fetchPageText, type FetchPageResult } from '../deepscan/fetch.js';
import { rankLinks } from '../deepscan/rank.js';
import { readPdfText } from '../deepscan/pdf.js';
import { READER_SYSTEM_PROMPT, buildReaderPrompt } from '../prompts/reader.js';
import { JUDGE_SYSTEM_PROMPT, buildJudgePrompt } from '../prompts/judge.js';
import { verifyExtractionEvidence } from '../extract/evidence.js';
import { ExtractionSchema, type Extraction } from '../schemas/extraction.js';
import {
  JudgeVerdictSchema,
  reconcileExtractions,
  resolveConflictsWithJudge,
  type Conflict,
  type JudgeCall,
  type JudgeTransport,
  type ReconcilePage,
} from '../extract/reconcile.js';
import { buildCoveragePayload } from '../deepscan/coverage.js';
import {
  SAY_GOT_IT,
  SAY_PAGE_WOULD_NOT_OPEN,
  formatFindingStatus,
  formatG1Prompt,
  formatG2Conflict,
  formatReadingStatus,
} from '../voice/index.js';
import type { RunEvent } from '../schemas/events.js';
import type { Gate, RunRecord } from '../agent/types.js';
import type { UsageEntry } from '../deepscan/orchestrator.js';

export const CONVERSATION_MAX_ROUNDS = 3;
const RETRY_BACKOFF_MS = [500, 1000];

let cachedPrompt: string | null = null;

/** Canonical conversation prompt (section 2). Loaded from the .md source. */
export function loadConversationPrompt(): string {
  if (cachedPrompt) return cachedPrompt;
  cachedPrompt = readFileSync(new URL('../prompts/orchestrator.md', import.meta.url), 'utf-8');
  return cachedPrompt;
}

export const CONVERSATION_TOOL_DEFS: ResponsesFunctionTool[] = [
  {
    type: 'function',
    name: 'find_links',
    description: 'Rank one fetched page’s outbound links by how likely they hold dates or requirements. Returns ranked same-site links.',
    parameters: { type: 'object', properties: { page_url: { type: 'string' } }, required: ['page_url'] },
  },
  {
    type: 'function',
    name: 'fetch_page',
    description: 'Fetch one official-site page. Returns title, size and a snippet — not the full text. Use read_page for extraction.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
  {
    type: 'function',
    name: 'read_pdf',
    description: 'Extract text from a PDF (for pages fetch_page reports as PDF, or .pdf URLs), then extract dates and requirements from it.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
  {
    type: 'function',
    name: 'read_page',
    description: 'Run the reader over one page: fetches it, extracts dates, documents and eligibility with evidence quotes. Sets the working program on first use.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
  {
    type: 'function',
    name: 'web_search',
    description: 'Search the web for a fact the stored pages do not answer. Returns a short sourced answer.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    type: 'function',
    name: 'list_reminders',
    description: 'List the user’s open reminders (deadlines already saved).',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'propose_plan',
    description: 'Present the application plan card once requirements are confirmed.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        deadlines: { type: 'array', items: { type: 'string' } },
        items: { type: 'array', items: { type: 'string' } },
        portalUrl: { type: ['string', 'null'] },
      },
      required: ['title', 'deadlines', 'items'],
    },
  },
  {
    type: 'function',
    name: 'ask_profile_question',
    description: 'Ask exactly one profile question that blocks fit or drafts. Returns it to the user immediately.',
    parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
  },
  {
    type: 'function',
    name: 'draft_document',
    description: 'Return a draft payload for review. It is never sent anywhere; the user approves at G5.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['kind', 'title', 'body'],
    },
  },
  {
    type: 'function',
    name: 'request_approval',
    description: 'Stop and ask the human. G1 confirms the program, G2 resolves conflicting pages, G5 approves a draft.',
    parameters: {
      type: 'object',
      properties: {
        gate: { type: 'string', enum: ['G1', 'G2', 'G3', 'G4', 'G5'] },
        what: { type: 'string' },
        card: {
          type: 'object',
          description: 'Program card the UI renders. Use kind "program" with string fields name, unit, institution, portal_url and source_url.',
          properties: {
            kind: { type: 'string' },
            name: { type: 'string' },
            unit: { type: 'string' },
            institution: { type: 'string' },
            portal_url: { type: ['string', 'null'] },
            source_url: { type: 'string' },
          },
        },
        options: { type: ['array', 'null'] },
      },
      required: ['gate', 'what'],
    },
  },
  {
    type: 'function',
    name: 'finish',
    description: 'End the turn with a one-sentence summary of what was found.',
    parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
  },
];

export interface ConversationMemory {
  responseId: string | null;
  programUrl: string | null;
  programHint: string | null;
  pages: Array<{ url: string; title: string }>;
  unreadable: Array<{ url: string; reason: string }>;
  languages: string[];
  extractions: ReconcilePage[];
  usage: UsageEntry[];
  /** Last assistant text, kept so the turn after a gate can recap it. */
  lastReply: string | null;
  /** The gate the previous turn stopped at, if any. */
  gateContext: { gate: Gate; what: string } | null;
}

function blankMemory(): ConversationMemory {
  return { responseId: null, programUrl: null, programHint: null, pages: [], unreadable: [], languages: [], extractions: [], usage: [], lastReply: null, gateContext: null };
}

function readMemory(run: RunRecord): ConversationMemory {
  const mem = (run.state as Record<string, unknown>)['conversation'];
  if (!mem || typeof mem !== 'object') return blankMemory();
  const m = mem as Partial<ConversationMemory>;
  return {
    responseId: typeof m.responseId === 'string' ? m.responseId : null,
    programUrl: typeof m.programUrl === 'string' ? m.programUrl : null,
    programHint: typeof m.programHint === 'string' ? m.programHint : null,
    pages: Array.isArray(m.pages) ? m.pages : [],
    unreadable: Array.isArray(m.unreadable) ? m.unreadable : [],
    languages: Array.isArray(m.languages) ? m.languages : [],
    extractions: Array.isArray(m.extractions) ? m.extractions : [],
    usage: Array.isArray(m.usage) ? m.usage : [],
    lastReply: typeof m.lastReply === 'string' ? m.lastReply : null,
    gateContext: m.gateContext && typeof m.gateContext === 'object' ? (m.gateContext as ConversationMemory['gateContext']) : null,
  };
}

function writeMemory(run: RunRecord, mem: ConversationMemory): void {
  (run.state as Record<string, unknown>)['conversation'] = mem;
}

export interface ReminderRow {
  id: string;
  text: string;
  dueAt?: string | null;
}

export interface ReadPageTextResult {
  extraction: Extraction;
  costUsd: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ConversationTurnDeps {
  fetchPage?: (url: string) => Promise<FetchPageResult>;
  readPageText?: (page: { url: string; title: string; text: string }, ctx: { programHint: string | null; userId: string }) => Promise<ReadPageTextResult>;
  judge?: JudgeTransport;
  listReminders?: () => Promise<ReminderRow[]>;
  streamCall?: (opts: StreamCallOptions) => Promise<ResponsesCallResult>;
  sleepMs?: (ms: number) => Promise<void>;
}

export interface ConversationTurnOptions extends ConversationTurnDeps {
  run: RunRecord;
  save: (run: RunRecord) => Promise<void>;
  userText: string;
  userId?: string;
  send: (event: RunEvent) => void;
  maxRounds?: number;
  /** Observability hook (tests, probes). Routes leave it unset. */
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
}

export interface ConversationTurnResult {
  gated: boolean;
  gate?: Gate;
  text: string;
  usageUsd: number;
}

function messageText(items: ResponsesItem[]): string {
  const parts: string[] = [];
  for (const item of items) {
    if (item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part.text) parts.push(part.text);
    }
  }
  return parts.join('').trim();
}

function functionCalls(items: ResponsesItem[]): Array<{ name: string; callId: string; argsText: string }> {
  const calls: Array<{ name: string; callId: string; argsText: string }> = [];
  for (const item of items) {
    if (item.type === 'function_call' && item.name) {
      calls.push({ name: item.name, callId: item.call_id ?? item.id ?? '', argsText: item.arguments ?? '{}' });
    }
  }
  return calls;
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Fall through to {}: unknown tools report an error rather than throw.
  }
  return {};
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export async function runConversationTurn(opts: ConversationTurnOptions): Promise<ConversationTurnResult> {
  const userId = opts.userId ?? 'dev';
  const maxRounds = opts.maxRounds ?? CONVERSATION_MAX_ROUNDS;
  const sleepMs = opts.sleepMs ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const streamCall = opts.streamCall ?? streamResponsesCall;
  const fetchPage = opts.fetchPage ?? fetchPageText;
  const judge: JudgeTransport = opts.judge ?? defaultJudge;
  const listReminders = opts.listReminders;
  const readPageText: NonNullable<ConversationTurnDeps['readPageText']> =
    opts.readPageText ?? ((page) => readAndExtract(page.url, page.title, page.text));
  const tools = listReminders ? CONVERSATION_TOOL_DEFS : CONVERSATION_TOOL_DEFS.filter((t) => t.name !== 'list_reminders');

  const { run, save, send } = opts;
  const mem = readMemory(run);
  const pageCache = new Map<string, FetchPageResult>();
  const logUsage = (entry: Omit<UsageEntry, 'turn'>): void => {
    mem.usage.push({ ...entry, turn: run.turnCount });
    run.usageUsd += entry.costUsd;
  };
  const persist = async (): Promise<void> => {
    writeMemory(run, mem);
    await save(run);
  };

  run.messages.push({ role: 'user', text: opts.userText });
  run.turnCount += 1;

  let fullText = '';
  const messageId = `conv-${run.id}-t${run.turnCount}`;
  const emitText = (delta: string): void => {
    fullText += delta;
    send({ t: 'message', id: messageId, text: delta });
  };

  async function callWithRetry(callOpts: StreamCallOptions, allowFreshRetry = false): Promise<ResponsesCallResult> {
    let attempt = 0;
    let freshTried = false;
    for (;;) {
      try {
        return await streamCall(callOpts);
      } catch (err) {
        if (err instanceof BudgetExceededError) throw err;
        const notFound = err instanceof Error && err.message.includes('referenced response not found or expired');
        if (notFound && allowFreshRetry && !freshTried) {
          // The provider intermittently refuses to chain onto a
          // seconds-old response (observed nondeterministically across
          // identical turns). The round-0 input is standalone-safe text,
          // so restart the chain instead of failing the turn.
          freshTried = true;
          callOpts = { ...callOpts, previousResponseId: null };
          continue;
        }
        if (attempt >= 2) {
          const last = err instanceof Error ? err.message : 'transport error';
          throw new Error(`orchestrator transport failed after 3 attempts (last: ${last})`);
        }
        await sleepMs(notFound ? ([2000, 5000][attempt] ?? 5000) : (RETRY_BACKOFF_MS[attempt] ?? 1000));
        attempt += 1;
      }
    }
  }

  const getPage = async (url: string): Promise<FetchPageResult> => {
    const hit = pageCache.get(url);
    if (hit) return hit;
    const page = await fetchPage(url);
    pageCache.set(url, page);
    return page;
  };

  const pushCoverageCard = (): void => {
    const payload = buildCoveragePayload({ pagesRead: mem.pages, unreadable: mem.unreadable, languages: mem.languages });
    send({ t: 'card', id: `${run.id}-t${run.turnCount}-coverage`, kind: 'coverage', payload });
  };

  /** Merge one extraction, reconcile, and G2-gate when conflicts stand. */
  const mergeAndReconcile = async (
    url: string,
    title: string,
    extraction: Extraction,
    readerCost: { costUsd: number; model: string | null; inputTokens: number | null; outputTokens: number | null },
  ): Promise<{ gate: { gate: Gate; what: string; evidence: unknown; options: unknown } | null; summary: string }> => {
    mem.extractions.push({ url, title, extraction });
    if (!mem.pages.some((p) => p.url === url)) mem.pages.push({ url, title });
    if (!mem.programUrl) {
      mem.programUrl = url;
      const hint = extraction.program.name.value || extraction.program.institution.value || '';
      if (hint) mem.programHint = hint.slice(0, 120);
    }
    logUsage({ kind: 'tool', tool: 'read_page', role: 'reader', model: readerCost.model, inputTokens: readerCost.inputTokens, outputTokens: readerCost.outputTokens, costUsd: readerCost.costUsd });
    pushCoverageCard();
    const rec = reconcileExtractions(mem.extractions, mem.programUrl);
    if (rec.conflicts.length === 0) {
      const deadlines = rec.merged?.deadlines.length ?? 0;
      return { gate: null, summary: `read ${title || url}; ${deadlines} deadline(s) extracted, no conflicts` };
    }
    let remaining = rec.conflicts;
    try {
      const res = await resolveConflictsWithJudge(rec.merged ?? extraction, rec.conflicts, judge, userId);
      logUsage({ kind: 'model', tool: null, role: 'judge', model: res.judgeUsage?.model ?? null, inputTokens: res.judgeUsage?.inputTokens ?? null, outputTokens: res.judgeUsage?.outputTokens ?? null, costUsd: res.costUsd });
      remaining = res.remaining;
    } catch {
      // Judge unreachable: fall through with code-detected conflicts.
    }
    if (remaining.length === 0) return { gate: null, summary: `read ${title || url}; conflicts resolved by judge` };
    const coverage = buildCoveragePayload({ pagesRead: mem.pages, unreadable: mem.unreadable, languages: mem.languages });
    return {
      gate: {
        gate: 'G2',
        what: formatG2Conflict(remaining.map((c) => c.field)),
        evidence: { origin: 'chat', conflicts: remaining, coverage },
        options: null,
      },
      summary: `read ${title || url}; ${remaining.length} conflict(s) need the human`,
    };
  };

  const readAndExtract = async (
    url: string,
    title: string,
    text: string,
  ): Promise<{ extraction: Extraction; costUsd: number; model: string; inputTokens: number; outputTokens: number }> => {
    const sliced = text.slice(0, 60_000);
    const result = await callModel({
      role: 'reader',
      systemPrompt: READER_SYSTEM_PROMPT,
      prompt: buildReaderPrompt(sliced, url, mem.programHint),
      schema: ExtractionSchema,
      temperature: 0,
      userId,
    });
    return {
      extraction: verifyExtractionEvidence(sliced, result.data as Extraction),
      costUsd: result.costUsd,
      model: result.model,
      inputTokens: result.usage?.prompt_tokens ?? 0,
      outputTokens: result.usage?.completion_tokens ?? 0,
    };
  };

  type ExecOutcome = { output: unknown; gate?: { gate: Gate; what: string; evidence: unknown; options: unknown } };

  const executeTool = async (name: string, args: Record<string, unknown>): Promise<ExecOutcome> => {
    if (name === 'find_links') {
      const pageUrl = str(args['page_url'])?.trim() || null;
      if (!pageUrl) return { output: { error: 'page_url is required' } };
      try {
        const page = await getPage(pageUrl);
        const ranked = rankLinks(pageUrl, page.links.map((l) => ({ href: l.href, text: l.text })), { programHint: mem.programHint });
        return { output: { page_url: pageUrl, title: page.title, links: ranked.slice(0, 8) } };
      } catch (err) {
        return { output: { error: err instanceof Error ? err.message : 'fetch failed' } };
      }
    }
    if (name === 'fetch_page') {
      const url = str(args['url'])?.trim() || null;
      if (!url) return { output: { error: 'url is required' } };
      const statusId = `conv-${run.id}-t${run.turnCount}-fetch`;
      send({ t: 'status', id: statusId, label: formatFindingStatus(url), state: 'active' });
      try {
        const page = await getPage(url);
        send({ t: 'status', id: statusId, label: formatFindingStatus(url), state: 'done' });
        return { output: { url, title: page.title, size: page.text.length, snippet: page.text.slice(0, 2000) } };
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'fetch failed';
        send({ t: 'status', id: statusId, label: formatFindingStatus(url), state: 'failed' });
        if (!mem.unreadable.some((u) => u.url === url)) mem.unreadable.push({ url, reason });
        return { output: { error: reason } };
      }
    }
    if (name === 'read_pdf') {
      const url = str(args['url'])?.trim() || null;
      if (!url) return { output: { error: 'url is required' } };
      try {
        const { bytes } = await fetchBytes(url);
        const pdf = await readPdfText(bytes);
        if (!pdf.readable) {
          if (!mem.unreadable.some((u) => u.url === url)) mem.unreadable.push({ url, reason: pdf.reason });
          return { output: { error: pdf.reason } };
        }
        const read = await readPageText({ url, title: url, text: pdf.text }, { programHint: mem.programHint, userId });
        return { output: (await mergeAndReconcile(url, url, read.extraction, { costUsd: read.costUsd, model: read.model, inputTokens: read.inputTokens, outputTokens: read.outputTokens })).summary };
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'pdf read failed';
        if (!mem.unreadable.some((u) => u.url === url)) mem.unreadable.push({ url, reason });
        return { output: { error: reason } };
      }
    }
    if (name === 'read_page') {
      const url = str(args['url'])?.trim() || null;
      if (!url) return { output: { error: 'url is required' } };
      const statusId = `conv-${run.id}-t${run.turnCount}-read`;
      send({ t: 'status', id: statusId, label: formatFindingStatus(url), state: 'active' });
      try {
        const page = await getPage(url);
        send({ t: 'status', id: statusId, label: formatReadingStatus('generic_opportunity'), state: 'active' });
        const read = await readPageText({ url, title: page.title, text: page.text }, { programHint: mem.programHint, userId });
        send({ t: 'status', id: statusId, label: formatReadingStatus(read.extraction.opportunity_type, read.extraction.program.institution.value || undefined), state: 'done' });
        const merged = await mergeAndReconcile(url, page.title, read.extraction, { costUsd: read.costUsd, model: read.model, inputTokens: read.inputTokens, outputTokens: read.outputTokens });
        if (merged.gate) return { output: { gated: true, summary: merged.summary }, gate: merged.gate };
        return { output: { summary: merged.summary } };
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'read failed';
        send({ t: 'status', id: statusId, label: formatFindingStatus(url), state: 'failed' });
        if (!mem.unreadable.some((u) => u.url === url)) mem.unreadable.push({ url, reason });
        return { output: { error: reason } };
      }
    }
    if (name === 'web_search') {
      const query = str(args['query']);
      if (!query) return { output: { error: 'query is required' } };
      const res = await responsesCall({
        model: ROLE_MODEL_MAP.orchestrator,
        effort: 'low',
        systemPrompt: 'Answer briefly with facts and their sources. Never invent a date or rule.',
        input: query,
        tools: [{ type: 'web_search' }],
        previousResponseId: null,
        userId,
      });
      logUsage({ kind: 'model', tool: 'web_search', role: 'orchestrator', model: res.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd: res.costUsd });
      return { output: { answer: messageText(res.items), model: res.model } };
    }
    if (name === 'list_reminders') {
      if (!listReminders) return { output: { error: 'reminders are unavailable' } };
      const rows = await listReminders();
      return { output: { reminders: rows } };
    }
    if (name === 'propose_plan') {
      const payload = {
        title: str(args['title']) ?? 'Application plan',
        deadlines: Array.isArray(args['deadlines']) ? (args['deadlines'] as unknown[]).filter((d): d is string => typeof d === 'string') : [],
        items: Array.isArray(args['items']) ? (args['items'] as unknown[]).filter((d): d is string => typeof d === 'string') : [],
        portalUrl: str(args['portalUrl']),
      };
      send({ t: 'card', id: `conv-${run.id}-t${run.turnCount}-plan`, kind: 'plan', payload });
      return { output: { proposed: true } };
    }
    if (name === 'ask_profile_question') {
      const question = str(args['question']) ?? '';
      send({ t: 'message', id: `conv-${run.id}-t${run.turnCount}-q`, text: question });
      return { output: { asked: true, note: 'the question is already shown to the user; do not repeat it verbatim in your reply' } };
    }
    if (name === 'draft_document') {
      const payload = { kind: str(args['kind']) ?? 'draft', title: str(args['title']) ?? 'Draft', body: str(args['body']) ?? '' };
      send({ t: 'card', id: `conv-${run.id}-t${run.turnCount}-draft`, kind: 'draft', payload: { ...payload, deferred: true, note: 'For review only — nothing is sent without your G5 approval.' } });
      return { output: { deferred: true } };
    }
    if (name === 'request_approval') {
      const gate = str(args['gate']);
      if (gate !== 'G1' && gate !== 'G2' && gate !== 'G3' && gate !== 'G4' && gate !== 'G5') {
        return { output: { error: 'unknown gate' } };
      }
      const what = str(args['what']) ?? 'Confirm to continue.';
      const card = (args['card'] && typeof args['card'] === 'object' ? args['card'] : null) as Record<string, unknown> | null;
      const options = Array.isArray(args['options']) ? args['options'] : null;
      return { output: { gated: true }, gate: { gate, what, evidence: { origin: 'chat', card }, options } };
    }
    if (name === 'finish') {
      return { output: { finished: true, summary: str(args['summary']) ?? '' } };
    }
    return { output: { error: `unknown tool: ${name}` } };
  };

  // Section 1 input flow: chain the stored response id while the turns
  // flow; after a gate the provider will not retain the gate-ended response
  // (chaining 400s), so the next turn restarts the chain with a short text
  // recap instead. Within-turn rounds always chain.
  let input: unknown = opts.userText;
  if (mem.gateContext) {
    const parts: string[] = [];
    if (mem.lastReply) parts.push(`Earlier in this conversation you said: "${mem.lastReply.slice(0, 500)}"`);
    parts.push(`Open question (${mem.gateContext.gate}, answered through the approval UI, not here): ${mem.gateContext.what.slice(0, 300)}`);
    if (mem.programUrl) parts.push(`Working program page: ${mem.programUrl}${mem.programHint ? ` (${mem.programHint})` : ''}`);
    const known = mem.pages.map((p) => p.url).filter((u) => u !== mem.programUrl).slice(0, 5);
    if (known.length > 0) parts.push(`Other pages already read this run: ${known.join(', ')}`);
    if (mem.unreadable.length > 0) parts.push(`Pages that would not open: ${mem.unreadable.map((u) => u.url).slice(0, 5).join(', ')}`);
    parts.push(`New message: ${opts.userText}`);
    input = parts.join('\n');
  }
  mem.gateContext = null;
  for (let round = 0; round < maxRounds; round += 1) {
    const result = await callWithRetry(
      {
        model: ROLE_MODEL_MAP.orchestrator,
        effort: 'medium',
        systemPrompt: loadConversationPrompt(),
        input,
        tools,
        previousResponseId: mem.responseId,
        userId,
        onText: emitText,
      },
      round === 0,
    );
    logUsage({ kind: 'model', tool: null, role: 'orchestrator', model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: result.costUsd });
    mem.responseId = result.responseId || mem.responseId;
    await persist();

    const calls = functionCalls(result.items);
    if (calls.length === 0) break;
    const outputs: unknown[] = [];
    let gateHit: { gate: Gate; what: string; evidence: unknown; options: unknown } | null = null;
    for (const call of calls) {
      const args = parseArgs(call.argsText);
      opts.onToolCall?.(call.name, args);
      const outcome = await executeTool(call.name, args);
      if (outcome.gate) gateHit = outcome.gate;
      outputs.push({ type: 'function_call_output', call_id: call.callId, output: JSON.stringify(outcome.output) });
    }
    await persist();
    if (gateHit) {
      if (gateHit.gate === 'G1') {
        const card = (gateHit.evidence as { card?: Record<string, unknown> } | null)?.card;
        let source = card && typeof card['source_url'] === 'string' ? (card['source_url'] as string) : null;
        if (!source && mem.pages.length > 0) {
          // The model confirmed a page it read but did not cite it: point
          // the card at the most recently read page instead of guessing.
          source = mem.pages[mem.pages.length - 1]?.url ?? null;
          if (source && card) card['source_url'] = source;
        }
        if (source && !mem.programUrl) {
          mem.programUrl = source;
          const hint = typeof card?.['name'] === 'string' ? (card['name'] as string) : null;
          if (hint) mem.programHint = hint.slice(0, 120);
        }
      }
      // Fresh chain next turn: the gate-ended response is not chainable.
      mem.responseId = null;
      mem.lastReply = fullText || null;
      mem.gateContext = { gate: gateHit.gate, what: gateHit.what };
      run.pendingGate = { gate: gateHit.gate, what: gateHit.what, evidence: gateHit.evidence, options: gateHit.options };
      run.status = 'needs_approval';
      await persist();
      return { gated: true, gate: gateHit.gate, text: fullText, usageUsd: run.usageUsd };
    }
    input = outputs;
  }
  mem.lastReply = fullText || mem.lastReply;

  if (fullText.trim().length === 0) {
    fullText = SAY_GOT_IT;
    send({ t: 'message', id: messageId, text: fullText });
  }
  run.messages.push({ role: 'assistant', text: fullText });
  await persist();
  return { gated: false, text: fullText, usageUsd: run.usageUsd };
}

async function defaultJudge({ conflicts, userId }: { conflicts: Conflict[]; userId?: string }): Promise<JudgeCall> {
  const result = await callModel({
    role: 'judge',
    systemPrompt: JUDGE_SYSTEM_PROMPT,
    prompt: buildJudgePrompt(conflicts),
    schema: JudgeVerdictSchema,
    temperature: 0,
    userId: userId ?? 'dev',
  });
  const verdict = JudgeVerdictSchema.parse(result.data);
  return {
    verdict,
    costUsd: result.costUsd,
    model: result.usage ? ROLE_MODEL_MAP.judge : undefined,
    inputTokens: result.usage?.prompt_tokens,
    outputTokens: result.usage?.completion_tokens,
  };
}
