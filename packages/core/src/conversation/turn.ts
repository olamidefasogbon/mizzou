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
  isRetryableTransportError,
  responsesCall,
  streamResponsesCall,
  type ResponsesCallResult,
  type ResponsesFunctionTool,
  type ResponsesItem,
  type StreamCallOptions,
} from '../meta/responses.js';
import { BudgetExceededError, type BudgetGuard } from '../meta/budget.js';
import { ROLE_MODEL_MAP } from '../meta/registry.js';
import { fetchBytes, fetchPageText, type FetchPageResult } from '../deepscan/fetch.js';
import { rankLinks } from '../deepscan/rank.js';
import { readPdfText } from '../deepscan/pdf.js';
import { READER_SYSTEM_PROMPT, buildReaderPrompt } from '../prompts/reader.js';
import { JUDGE_SYSTEM_PROMPT, buildJudgePrompt } from '../prompts/judge.js';
import { FIT_JUDGE_SYSTEM_PROMPT, FitAssessmentSchema, buildFitPrompt, type FitAssessment, type FitAssessmentInput } from '../prompts/fit.js';
import { DraftSchema, WRITER_SYSTEM_PROMPT, buildWriterEditPrompt, buildWriterPrompt, isDraftKind, type DraftKind, type WriterCreateInput } from '../prompts/writer.js';
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
import { FIT_APPLY_LABEL, FIT_CARD_TITLE, FIT_PARK_LABEL, FIT_QUESTION } from '../voice/index.js';
import {
  ROLLING_NOTICE_TEXT,
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
    name: 'edit_draft',
    description: 'Rewrite the open draft following one edit instruction. Keeps a new version, emits the updated card, stops at G5 again.',
    parameters: {
      type: 'object',
      properties: {
        instruction: { type: 'string' },
      },
      required: ['instruction'],
    },
  },
  {
    type: 'function',
    name: 'draft_document',
    description: 'Draft a statement, email or answer with the writer role from the confirmed profile facts. Emits a draft card and stops at G5 for keep. Missing facts become [PLACEHOLDER]; it is never sent anywhere.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string' },
        title: { type: 'string' },
        instructions: { type: 'string' },
      },
      required: ['kind', 'title'],
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
  /** Stored profile facts: each answered profile question. */
  profile: Array<{ question: string; answer: string }>;
  /** Question asked by ask_profile_question, awaiting the user's answer. */
  pendingProfileQuestion: string | null;
  /** Fit read asked at most once per run; the answer is recorded once in decisions. */
  fitAsked: boolean;
  fitDecision: 'apply' | 'not_now' | null;
  /** Draft versions, oldest first. Each chat edit keeps a new row; latest wins. */
  drafts: Array<{ kind: string; title: string; body: string; version: number; kept: boolean }>;
}

function blankMemory(): ConversationMemory {
  return { programUrl: null, programHint: null, pages: [], unreadable: [], languages: [], extractions: [], usage: [], lastReply: null, gateContext: null, profile: [], pendingProfileQuestion: null, fitAsked: false, fitDecision: null, drafts: [] };
}

function readMemory(run: RunRecord): ConversationMemory {
  const mem = (run.state as Record<string, unknown>)['conversation'];
  if (!mem || typeof mem !== 'object') return blankMemory();
  const m = mem as Partial<ConversationMemory>;
  return {
    programUrl: typeof m.programUrl === 'string' ? m.programUrl : null,
    programHint: typeof m.programHint === 'string' ? m.programHint : null,
    pages: Array.isArray(m.pages) ? m.pages : [],
    unreadable: Array.isArray(m.unreadable) ? m.unreadable : [],
    languages: Array.isArray(m.languages) ? m.languages : [],
    extractions: Array.isArray(m.extractions) ? m.extractions : [],
    usage: Array.isArray(m.usage) ? m.usage : [],
    lastReply: typeof m.lastReply === 'string' ? m.lastReply : null,
    gateContext: m.gateContext && typeof m.gateContext === 'object' ? (m.gateContext as ConversationMemory['gateContext']) : null,
    profile: Array.isArray(m.profile)
      ? (m.profile as unknown[])
          .filter((f): f is { question: string; answer: string } => !!f && typeof f === 'object' && typeof (f as { question?: unknown }).question === 'string' && typeof (f as { answer?: unknown }).answer === 'string')
          .map((f) => ({ question: f.question, answer: f.answer }))
      : [],
    pendingProfileQuestion: typeof m.pendingProfileQuestion === 'string' ? m.pendingProfileQuestion : null,
    fitAsked: m.fitAsked === true,
    fitDecision: m.fitDecision === 'apply' || m.fitDecision === 'not_now' ? m.fitDecision : null,
    drafts: Array.isArray(m.drafts)
      ? (m.drafts as unknown[])
          .filter((d): d is { kind: string; title: string; body: string; version: number; kept: boolean } => !!d && typeof d === 'object' && typeof (d as { body?: unknown }).body === 'string')
          .map((d) => ({ kind: typeof (d as { kind?: unknown }).kind === 'string' ? (d as { kind: string }).kind : 'statement', title: typeof (d as { title?: unknown }).title === 'string' ? (d as { title: string }).title : 'Draft', body: (d as { body: string }).body, version: typeof (d as { version?: unknown }).version === 'number' ? (d as { version: number }).version : 1, kept: (d as { kept?: unknown }).kept === true }))
      : [],
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

export interface WriterCreateRequest {
  mode: 'create';
  kind: DraftKind;
  title: string;
  instructions: string | null;
}

export interface WriterEditRequest {
  mode: 'edit';
  instruction: string;
}

export interface ConversationTurnDeps {
  fetchPage?: (url: string) => Promise<FetchPageResult>;
  readPageText?: (page: { url: string; title: string; text: string }, ctx: { programHint: string | null; userId: string }) => Promise<ReadPageTextResult>;
  judge?: JudgeTransport;
  /** Judge-role fit read. Defaults to a callModel judge call; tests inject a mock (no paid runs). */
  assessFit?: (input: FitAssessmentInput) => Promise<FitAssessment>;
  /** Writer-role draft create/rewrite. Defaults to a callModel writer call; tests inject a mock (no paid runs). */
  writeDraft?: (input: WriterCreateRequest | WriterEditRequest) => Promise<string>;
  listReminders?: () => Promise<ReminderRow[]>;
  streamCall?: (opts: StreamCallOptions) => Promise<ResponsesCallResult>;
  sleepMs?: (ms: number) => Promise<void>;
}

export interface ConversationTurnOptions extends ConversationTurnDeps {
  run: RunRecord;
  save: (run: RunRecord) => Promise<void>;
  userText: string;
  userId?: string;
  /** Usage-backed budget guard (routes build one per request). Defaults to the shared process guard. */
  budgetGuard?: BudgetGuard;
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

/**
 * Single choke point for Responses input assembly. The ONLY place that
 * appends round output to the turn thread: replayed items keep their first
 * position and are never duplicated by id. `function_call_output` items
 * carry no `id`, so they dedupe on `call_id`; plain history messages pass
 * through untouched.
 */
export function buildInput(history: unknown[], newItems: unknown[]): unknown[] {
  const keyOf = (item: unknown): string | null => {
    if (typeof item !== 'object' || item === null) return null;
    const record = item as { id?: unknown; call_id?: unknown };
    if (typeof record.id === 'string' && record.id.length > 0) return `id:${record.id}`;
    if (typeof record.call_id === 'string' && record.call_id.length > 0) return `call:${record.call_id}`;
    return null;
  };
  const out: unknown[] = [...history];
  const seen = new Set<string>();
  for (const item of out) {
    const key = keyOf(item);
    if (key !== null) seen.add(key);
  }
  for (const item of newItems) {
    const key = keyOf(item);
    if (key !== null) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(item);
  }
  return out;
}

/** Map one persisted run message to Responses input for stateless replay. */
function historyItem(message: unknown): unknown {
  const m = (message ?? {}) as { role?: unknown; text?: unknown };
  const text = typeof m.text === 'string' ? m.text : '';
  if (m.role === 'assistant') {
    return { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] };
  }
  return { type: 'message', role: 'user', content: [{ type: 'input_text', text }] };
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

/**
 * Decode a fit-card button press. The buttons post their exact labels as
 * chat messages, so this is exact label matching on a structured UI reply —
 * not branching on free text. The typographic apostrophe variant matches
 * smart-quote renderings of the apply label.
 */
function fitChoiceFromText(text: string): 'apply' | 'not_now' | null {
  const norm = text.trim().toLowerCase().split('’').join("'");
  if (norm === FIT_APPLY_LABEL.toLowerCase()) return 'apply';
  if (norm === FIT_PARK_LABEL.toLowerCase()) return 'not_now';
  return null;
}

export async function runConversationTurn(opts: ConversationTurnOptions): Promise<ConversationTurnResult> {
  const userId = opts.userId ?? 'dev';
  const budgetGuard = opts.budgetGuard;
  const maxRounds = opts.maxRounds ?? CONVERSATION_MAX_ROUNDS;
  const sleepMs = opts.sleepMs ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const streamCall = opts.streamCall ?? streamResponsesCall;
  const fetchPage = opts.fetchPage ?? fetchPageText;
  const judge: JudgeTransport = opts.judge ?? ((args) => defaultJudge(args, budgetGuard));
  const listReminders = opts.listReminders;
  const readPageText: NonNullable<ConversationTurnDeps['readPageText']> =
    opts.readPageText ?? ((page) => readAndExtract(page.url, page.title, page.text));
  const tools = listReminders ? CONVERSATION_TOOL_DEFS : CONVERSATION_TOOL_DEFS.filter((t) => t.name !== 'list_reminders');

  const { run, save, send } = opts;
  const mem = readMemory(run);
  const pageCache = new Map<string, FetchPageResult>();
  // Judge-role fit read (PROMPT.md 7.2). A throwing judge returns null so
  // the turn skips the fit card; like any tool failure it never ends the run.
  const runAssessFit = async (input: FitAssessmentInput): Promise<FitAssessment | null> => {
    try {
      if (opts.assessFit) return await opts.assessFit(input);
      const result = await callModel({
        role: 'judge',
        systemPrompt: FIT_JUDGE_SYSTEM_PROMPT,
        prompt: buildFitPrompt(input),
        schema: FitAssessmentSchema,
        temperature: 0,
        userId,
        budgetGuard,
      });
      logUsage({ kind: 'model', tool: null, role: 'judge', model: result.model, inputTokens: result.usage?.prompt_tokens ?? 0, outputTokens: result.usage?.completion_tokens ?? 0, costUsd: result.costUsd });
      return FitAssessmentSchema.parse(result.data);
    } catch {
      return null;
    }
  };
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
  // Durable fit decision (PROMPT.md 7.2: saved once in decisions, never
  // asked again). A recorded answer survives restarts: the memory mirror is
  // rebuilt here from the decisions row (upserted on op_id, so repeats
  // replay instead of deciding twice).
  const fitOpId = `fit-${run.id}`;
  const recorded = run.decisions.find((d) => d.opId === fitOpId);
  if (recorded && typeof recorded.decision === 'object' && recorded.decision !== null) {
    const choice = (recorded.decision as { choice?: unknown }).choice;
    if (choice === 'apply' || choice === 'not_now') {
      mem.fitAsked = true;
      mem.fitDecision = choice;
    }
  }
  // Kept drafts (PROMPT.md 7.5, G5). The resume route continues halted chat
  // runs with its own fixed-format control string; matching that exact
  // prefix decodes a structured Keep reply, not free text.
  const G5_KEEP_PREFIX = 'The user answered G5: ';
  let controlConsumed = false;
  if (opts.userText.startsWith(G5_KEEP_PREFIX)) {
    try {
      const keep = JSON.parse(opts.userText.slice(G5_KEEP_PREFIX.length)) as { kept?: unknown; kind?: unknown; version?: unknown };
      if (keep.kept === true) {
        const target = [...mem.drafts].reverse().find((d) => !d.kept && (typeof keep.kind !== 'string' || d.kind === keep.kind) && (typeof keep.version !== 'number' || d.version === keep.version));
        if (target) {
          target.kept = true;
          controlConsumed = true;
        }
      }
    } catch {
      // Not our control string: leave the text to the model.
    }
  }
  let fitDecidedThisTurn: 'apply' | 'not_now' | null = null;
  if (!mem.fitDecision && mem.fitAsked) {
    const choice = fitChoiceFromText(opts.userText);
    if (choice) {
      mem.fitDecision = choice;
      fitDecidedThisTurn = choice;
      if (!run.decisions.some((d) => d.opId === fitOpId)) {
        // G3 carries the row: the fit read closes the profile exchange, and
        // the decisions table only accepts gate values (see STATUS.md).
        run.decisions.push({ gate: 'G3', decision: { choice, question: 'go-for-it-anyway' }, opId: fitOpId });
      }
    }
  }
  if (!controlConsumed && !fitDecidedThisTurn && mem.pendingProfileQuestion && opts.userText.trim().length > 0) {
    mem.profile.push({ question: mem.pendingProfileQuestion, answer: opts.userText.slice(0, 2000) });
    mem.pendingProfileQuestion = null;
  }

  let fullText = '';
  const messageId = `conv-${run.id}-t${run.turnCount}`;
  const emitText = (delta: string): void => {
    fullText += delta;
    send({ t: 'message', id: messageId, text: delta });
  };

  // Stateless transport: previous_response_id is never used, so a missing
  // or expired response id can never fail a turn. Plain retries only.
  async function callWithRetry(callOpts: StreamCallOptions): Promise<ResponsesCallResult> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await streamCall(callOpts);
      } catch (err) {
        if (err instanceof BudgetExceededError) throw err;
        // 4xx (including 400 duplicate-item): fail fast with the full provider message, no retry.
        if (!isRetryableTransportError(err)) throw err;
        if (attempt >= 2) {
          const last = err instanceof Error ? err.message : 'transport error';
          throw new Error(`orchestrator transport failed after 3 attempts (last: ${last})`);
        }
        await sleepMs(RETRY_BACKOFF_MS[attempt] ?? 1000);
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

  /** Deadlines that passed the evidence post-check and carry a usable ISO instant. */
  const validIsoDeadlines = (extraction: Extraction): string[] => {
    const out: string[] = [];
    for (const d of extraction.deadlines) {
      const iso = d.field.value.iso_utc;
      if (!d.field.checked || typeof iso !== 'string' || iso.length === 0) continue;
      if (Number.isNaN(Date.parse(iso))) continue;
      out.push(iso);
    }
    return out;
  };

  /**
   * Card emission guards for a settled extraction. The requirements card
   * always mirrors the checked extraction — documents and eligibility read
   * from the page, so corporate jobs surface Resume/Work Authorization/
   * Portfolio, academic programs surface Transcripts/SOP/LORs, and funding
   * calls surface Proposal/Budget Deck with no hardcoded lists. The plan
   * card goes out only when valid ISO deadlines exist; otherwise the UI
   * gets a rolling notice instead of an empty plan.
   */
  const emitExtractionCards = (extraction: Extraction): void => {
    const cardId = `conv-${run.id}-t${run.turnCount}`;
    send({
      t: 'card',
      id: `${cardId}-requirements`,
      kind: 'requirements',
      payload: {
        documents: extraction.documents.map((d) => ({
          name: d.value.name,
          limit: d.value.limit,
          optional: d.value.optional,
          confidence: d.confidence,
          needs_human: d.needs_human,
          evidence_quote: d.evidence_quote,
          source_url: d.source_url,
        })),
        eligibility: extraction.eligibility.map((e) => ({
          rule: e.value.rule,
          hard: e.value.hard,
          confidence: e.confidence,
          needs_human: e.needs_human,
          evidence_quote: e.evidence_quote,
          source_url: e.source_url,
        })),
      },
    });
    const deadlines = validIsoDeadlines(extraction);
    if (deadlines.length > 0) {
      send({
        t: 'card',
        id: `${cardId}-plan`,
        kind: 'plan',
        payload: {
          title: extraction.program.name.value,
          deadlines,
          items: [],
          portalUrl: extraction.program.portal_url,
        },
      });
    } else {
      send({
        t: 'card',
        id: `${cardId}-rolling`,
        kind: 'rolling_notice',
        payload: { text: ROLLING_NOTICE_TEXT },
      });
    }
  };

  // Writer-role draft create/rewrite (PROMPT.md 7.5). A throwing writer
  // returns null so the tool reports a structured error; like any tool
  // failure it never ends the run.
  const runWriter = async (input: WriterCreateRequest | WriterEditRequest): Promise<string | null> => {
    try {
      if (opts.writeDraft) return await opts.writeDraft(input);
      const program = mem.programHint ?? mem.programUrl ?? 'this opportunity';
      if (input.mode === 'edit') {
        const current = [...mem.drafts].reverse().find((d) => !d.kept) ?? mem.drafts[mem.drafts.length - 1];
        if (!current) return null;
        const result = await callModel({
          role: 'writer',
          systemPrompt: WRITER_SYSTEM_PROMPT,
          prompt: buildWriterEditPrompt({ kind: current.kind as DraftKind, title: current.title, profile: mem.profile, program, current: current.body, instruction: input.instruction }),
          schema: DraftSchema,
          temperature: 0,
          userId,
          budgetGuard,
        });
        logUsage({ kind: 'model', tool: null, role: 'writer', model: result.model, inputTokens: result.usage?.prompt_tokens ?? 0, outputTokens: result.usage?.completion_tokens ?? 0, costUsd: result.costUsd });
        return DraftSchema.parse(result.data).body;
      }
      const result = await callModel({
        role: 'writer',
        systemPrompt: WRITER_SYSTEM_PROMPT,
        prompt: buildWriterPrompt({ kind: input.kind, title: input.title, profile: mem.profile, program, instructions: input.instructions }),
        schema: DraftSchema,
        temperature: 0,
        userId,
        budgetGuard,
      });
      logUsage({ kind: 'model', tool: null, role: 'writer', model: result.model, inputTokens: result.usage?.prompt_tokens ?? 0, outputTokens: result.usage?.completion_tokens ?? 0, costUsd: result.costUsd });
      return DraftSchema.parse(result.data).body;
    } catch {
      return null;
    }
  };
  /**
   * Plain-words fit card (PROMPT.md 7.2). Fires at most once per run, only
   * when the user has stated profile facts (never invent them) and the fit
   * question is still open. The payload carries words only — the internal
   * judge object, and any numbers, never leave the server.
   */
  const emitFitCard = async (extraction: Extraction): Promise<void> => {
    if (mem.profile.length === 0 || mem.fitAsked || mem.fitDecision) return;
    const assessment = await runAssessFit({
      program: extraction.program.name.value,
      rules: extraction.eligibility.map((r) => ({ rule: r.value.rule, hard: r.value.hard })),
      documents: extraction.documents.map((d) => ({ name: d.value.name, optional: d.value.optional })),
      profile: mem.profile,
    });
    if (!assessment) return;
    mem.fitAsked = true;
    send({
      t: 'card',
      id: `conv-${run.id}-t${run.turnCount}-fit`,
      kind: 'fit',
      payload: {
        title: FIT_CARD_TITLE,
        program: extraction.program.name.value,
        lines_up: assessment.matched,
        stretch: assessment.competitive_gaps.map((g) => g.note),
        missing: assessment.hard_gaps.map((g) => g.note),
        biggest_risk: assessment.biggest_risk,
        question: FIT_QUESTION,
        options: [FIT_APPLY_LABEL, FIT_PARK_LABEL],
      },
    });
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
      if (rec.merged) emitExtractionCards(rec.merged);
      if (rec.merged) await emitFitCard(rec.merged);
      return { gate: null, summary: `read ${title || url}; ${deadlines} deadline(s) extracted, no conflicts` };
    }
    let remaining = rec.conflicts;
    let settled: Extraction | null = rec.merged;
    try {
      const res = await resolveConflictsWithJudge(rec.merged ?? extraction, rec.conflicts, judge, userId);
      logUsage({ kind: 'model', tool: null, role: 'judge', model: res.judgeUsage?.model ?? null, inputTokens: res.judgeUsage?.inputTokens ?? null, outputTokens: res.judgeUsage?.outputTokens ?? null, costUsd: res.costUsd });
      remaining = res.remaining;
      settled = res.merged;
    } catch {
      // Judge unreachable: fall through with code-detected conflicts.
    }
    if (remaining.length === 0) {
      if (settled) emitExtractionCards(settled);
      if (settled) await emitFitCard(settled);
      return { gate: null, summary: `read ${title || url}; conflicts resolved by judge` };
    }
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
      budgetGuard,
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
        budgetGuard,
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
      mem.pendingProfileQuestion = question;
      send({ t: 'message', id: `conv-${run.id}-t${run.turnCount}-q`, text: question });
      return { output: { asked: true, note: 'the question is already shown to the user; do not repeat it verbatim in your reply' } };
    }
    if (name === 'draft_document') {
      const kindRaw = str(args['kind']) ?? '';
      if (!isDraftKind(kindRaw)) return { output: { error: 'kind must be one of statement, email, answer' } };
      const title = str(args['title'])?.trim() || 'Draft';
      const instructions = str(args['instructions']);
      const body = await runWriter({ mode: 'create', kind: kindRaw, title, instructions });
      if (!body) return { output: { error: 'the writer is unavailable right now' } };
      const version = mem.drafts.filter((d) => d.kind === kindRaw).length + 1;
      mem.drafts.push({ kind: kindRaw, title, body, version, kept: false });
      const card = { kind: 'draft', draftKind: kindRaw, title, body, version };
      send({ t: 'card', id: `conv-${run.id}-t${run.turnCount}-draft-${kindRaw}-v${version}`, kind: 'draft', payload: card });
      return { output: { version }, gate: { gate: 'G5', what: `Keep this ${title}?`, evidence: { origin: 'chat', card }, options: null } };
    }
    if (name === 'edit_draft') {
      const instruction = str(args['instruction'])?.trim() || '';
      if (!instruction) return { output: { error: 'instruction is required' } };
      const open = [...mem.drafts].reverse().find((d) => !d.kept);
      if (!open) return { output: { error: 'no open draft to edit' } };
      const body = await runWriter({ mode: 'edit', instruction });
      if (!body) return { output: { error: 'the writer is unavailable right now' } };
      const version = mem.drafts.filter((d) => d.kind === open.kind).length + 1;
      mem.drafts.push({ kind: open.kind, title: open.title, body, version, kept: false });
      const card = { kind: 'draft', draftKind: open.kind, title: open.title, body, version };
      send({ t: 'card', id: `conv-${run.id}-t${run.turnCount}-draft-${open.kind}-v${version}`, kind: 'draft', payload: card });
      return { output: { version }, gate: { gate: 'G5', what: `Keep this ${open.title}?`, evidence: { origin: 'chat', card }, options: null } };
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
  let firstInput = opts.userText;
  if (mem.gateContext) {
    const parts: string[] = [];
    if (mem.lastReply) parts.push(`Earlier in this conversation you said: "${mem.lastReply.slice(0, 500)}"`);
    parts.push(`Open question (${mem.gateContext.gate}, answered through the approval UI, not here): ${mem.gateContext.what.slice(0, 300)}`);
    if (mem.programUrl) parts.push(`Working program page: ${mem.programUrl}${mem.programHint ? ` (${mem.programHint})` : ''}`);
    const known = mem.pages.map((p) => p.url).filter((u) => u !== mem.programUrl).slice(0, 5);
    if (known.length > 0) parts.push(`Other pages already read this run: ${known.join(', ')}`);
    if (mem.unreadable.length > 0) parts.push(`Pages that would not open: ${mem.unreadable.map((u) => u.url).slice(0, 5).join(', ')}`);
    parts.push(`New message: ${opts.userText}`);
    firstInput = parts.join('\n');
  }
  if (fitDecidedThisTurn === 'apply') {
    firstInput = `The user answered "Want to go for it anyway?" with "Yes, let's apply" (recorded — never ask again). Carry on with the plan and drafts.\n${firstInput}`;
  } else if (fitDecidedThisTurn === 'not_now') {
    firstInput = `The user answered "Want to go for it anyway?" with "Not now" (recorded — never ask again). They parked this opportunity: acknowledge briefly, keep the existing reminders, do not propose new steps unless asked.\n${firstInput}`;
  }
  mem.gateContext = null;
  // Stateless replay: every round sends the persisted message history plus
  // this turn's thread so far. previous_response_id is never used, so turns
  // survive serverless with no chained responses.
  let thread: unknown[] = buildInput(run.messages.map(historyItem), [
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: firstInput }] },
  ]);
  for (let round = 0; round < maxRounds; round += 1) {
    const result = await callWithRetry(
      {
        model: ROLE_MODEL_MAP.orchestrator,
        effort: 'medium',
        systemPrompt: loadConversationPrompt(),
        input: thread,
        tools,
        previousResponseId: null,
        userId,
        budgetGuard,
        onText: emitText,
      },
    );
    logUsage({ kind: 'model', tool: null, role: 'orchestrator', model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: result.costUsd });
    await persist();

    const calls = functionCalls(result.items);
    if (calls.length === 0) break;
    const outputs: unknown[] = [];
    let gateHit: { gate: Gate; what: string; evidence: unknown; options: unknown } | null = null;
    for (const call of calls) {
      const args = parseArgs(call.argsText);
      opts.onToolCall?.(call.name, args);
      // A failing tool returns a structured result to the model; it never ends the run.
      // Only the budget guard propagates (it is a gate, not a tool failure).
      let outcome: ExecOutcome;
      try {
        outcome = await executeTool(call.name, args);
      } catch (err) {
        if (err instanceof BudgetExceededError) throw err;
        outcome = { output: { error: err instanceof Error ? err.message : String(err) } };
      }
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
      mem.lastReply = fullText || null;
      mem.gateContext = { gate: gateHit.gate, what: gateHit.what };
      run.pendingGate = { gate: gateHit.gate, what: gateHit.what, evidence: gateHit.evidence, options: gateHit.options };
      run.status = 'needs_approval';
      await persist();
      return { gated: true, gate: gateHit.gate, text: fullText, usageUsd: run.usageUsd };
    }
        // META_API_NOTES section 9: the API accepts function_call pairs without their reasoning item, so it is never replayed.
    const replayable = result.items.filter((item) => item.type !== 'reasoning');
    thread = buildInput(thread, [...replayable, ...outputs]);
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

async function defaultJudge({ conflicts, userId }: { conflicts: Conflict[]; userId?: string }, budgetGuard?: BudgetGuard): Promise<JudgeCall> {
  const result = await callModel({
    role: 'judge',
    systemPrompt: JUDGE_SYSTEM_PROMPT,
    prompt: buildJudgePrompt(conflicts),
    schema: JudgeVerdictSchema,
    temperature: 0,
    userId: userId ?? 'dev',
    budgetGuard,
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
