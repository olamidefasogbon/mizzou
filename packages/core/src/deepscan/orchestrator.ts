// Model-driven deep-scan orchestrator (PROMPT.md section 5.1 + 6.5).
// The model (orchestrator role, medium reasoning) decides which pages to
// read and when to finish, through function tools. Code keeps every
// guardrail: 12-turn cap (advance), 25-page cap, depth 2, same official
// site only, budget guard, zod-validated finish. Status lines come from
// the voice module. One model call per turn; tool results feed the next.

import { z } from 'zod';
import type { StepFn, StepOutcome } from '../agent/advance.js';
import { DEFAULT_MAX_TURNS } from '../agent/advance.js';
import type { PendingGate, RunRecord } from '../agent/types.js';
import { BudgetExceededError } from '../meta/budget.js';
import { ROLE_MODEL_MAP } from '../meta/registry.js';
import { callModel } from '../meta/callModel.js';
import { responsesCall, type ResponsesFunctionTool } from '../meta/responses.js';
import { ExtractionSchema, type Extraction } from '../schemas/extraction.js';
import type { RunEvent } from '../schemas/events.js';
import { verifyExtractionEvidence } from '../extract/evidence.js';
import {
  ConflictSchema,
  JudgeVerdictSchema,
  reconcileExtractions,
  resolveConflictsWithJudge,
  type Conflict,
  type JudgeCall,
  type JudgeTransport,
  type ReconcilePage,
} from '../extract/reconcile.js';
import { buildCoveragePayload } from './coverage.js';
import { READER_SYSTEM_PROMPT, buildReaderPrompt } from '../prompts/reader.js';
import { ORCHESTRATOR_SYSTEM_PROMPT, buildOrchestratorContext } from '../prompts/orchestrator.js';
import { JUDGE_SYSTEM_PROMPT, buildJudgePrompt } from '../prompts/judge.js';
import {
  SAY_BUDGET_HIT,
  SAY_GOT_IT,
  SAY_ON_IT,
  SAY_PAGE_WOULD_NOT_OPEN,
  formatFindingStatus,
  formatG2Conflict,
  formatReadingStatus,
} from '../voice/index.js';
import { PdfContentError, fetchBytes, fetchPageText, type OutboundLink } from './fetch.js';
import { rankLinks, sameSite } from './rank.js';
import { readPdfText } from './pdf.js';

/** Section 5.1 caps. */
export const MAX_SCAN_PAGES = 25;
export const MAX_SCAN_DEPTH = 2;

export const UsageEntrySchema = z.object({
  turn: z.number(),
  kind: z.enum(['model', 'tool']),
  tool: z.string().nullable(),
  role: z.string().nullable(),
  model: z.string().nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  costUsd: z.number(),
});

export type UsageEntry = z.infer<typeof UsageEntrySchema>;

export const FinishSchema = z.object({
  programUrl: z.string(),
  pagesRead: z.array(z.object({ url: z.string(), title: z.string() })),
  unreadable: z.array(z.object({ url: z.string(), reason: z.string() })),
  deadlinesFound: z.number(),
  extraction: ExtractionSchema.nullable(),
  conflicts: z.array(ConflictSchema).default([]),
  error: z.string().nullable(),
  summary: z.string().nullable(),
  usage: z.array(UsageEntrySchema),
  usageUsd: z.number(),
});

export type FinishResult = z.infer<typeof FinishSchema>;

interface QueuedPage {
  url: string;
  depth: number;
}

export interface DeepScanMemory {
  programUrl: string;
  programHint: string | null;
  opportunityType?: string;
  institution?: string;
  queue: QueuedPage[];
  seen: string[];
  depths: Record<string, number>;
  pages: Array<{ url: string; title: string }>;
  unreadable: Array<{ url: string; reason: string }>;
  extractions: Extraction[];
  reconciled: Extraction | null;
  conflicts: Conflict[];
  g2Asked: boolean;
  usageUsd: number;
  calls: UsageEntry[];
  responseId: string | null;
  pending: Array<{ callId: string; output: string }>;
  summary: string | null;
  errors: number;
  started: boolean;
}

export interface ReadPageResult {
  extraction: Extraction;
  costUsd: number;
  usage?: { model: string; inputTokens: number; outputTokens: number };
}

export interface ModelCall {
  callId: string;
  name: string;
  args: string;
}

export interface ModelTransportResult {
  responseId: string;
  calls: ModelCall[];
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export type ModelTransport = (args: {
  systemPrompt: string;
  input: unknown;
  tools: ResponsesFunctionTool[];
  previousResponseId: string | null;
  userId?: string;
  turn: number;
}) => Promise<ModelTransportResult>;

export interface DeepScanTools {
  fetchPage?: (url: string) => Promise<{ title: string; text: string; links: OutboundLink[] }>;
  readPdf?: (url: string) => Promise<{ readable: true; text: string } | { readable: false; reason: string }>;
  readPage?: (
    page: { url: string; title: string; text: string },
    ctx: { programHint: string | null; opportunityType?: string; userId?: string },
  ) => Promise<ReadPageResult>;
  model?: ModelTransport;
  judge?: JudgeTransport;
  maxPages?: number;
  maxDepth?: number;
}

const TOOL_DEFS: ResponsesFunctionTool[] = [
  {
    type: 'function',
    name: 'find_links',
    description: 'Rank one fetched page’s outbound links by how likely they hold dates or requirements. Returns ranked same-site links with their depths.',
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
    description: 'Extract text from a PDF (for pages fetch_page reports as PDF, or .pdf URLs).',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
  {
    type: 'function',
    name: 'read_page',
    description: 'Run the reader over one page: fetches it, extracts dates, documents and eligibility with evidence quotes, and counts it toward the page budget.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
  {
    type: 'function',
    name: 'request_approval',
    description: 'Stop and ask the human. Use only when the confirmed program itself looks wrong.',
    parameters: {
      type: 'object',
      properties: {
        gate: { type: 'string', enum: ['G1', 'G2', 'G3', 'G4', 'G5'] },
        what: { type: 'string' },
        evidence: {},
        options: {},
      },
      required: ['gate', 'what'],
    },
  },
  {
    type: 'function',
    name: 'finish',
    description: 'End the scan with a one-sentence summary of what was found.',
    parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
  },
];

async function defaultTransport(args: {
  systemPrompt: string;
  input: unknown;
  tools: ResponsesFunctionTool[];
  previousResponseId: string | null;
  userId?: string;
}): Promise<ModelTransportResult> {
  const result = await responsesCall({
    model: ROLE_MODEL_MAP.orchestrator,
    effort: 'medium',
    systemPrompt: args.systemPrompt,
    input: args.input,
    tools: args.tools,
    previousResponseId: args.previousResponseId,
    userId: args.userId,
  });
  return {
    responseId: result.responseId,
    calls: result.items
      .filter((item) => item.type === 'function_call' && item.call_id && item.name)
      .map((item) => ({ callId: item.call_id as string, name: item.name as string, args: item.arguments ?? '{}' })),
    text: result.items
      .filter((item) => item.type === 'message')
      .flatMap((item) => item.content ?? [])
      .filter((c) => c.type === 'output_text' && c.text)
      .map((c) => c.text as string)
      .join('\n'),
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
  };
}

async function defaultReadPage(
  page: { url: string; title: string; text: string },
  ctx: { programHint: string | null; opportunityType?: string; userId?: string },
): Promise<ReadPageResult> {
  const text = page.text.slice(0, 60_000);
  const result = await callModel({
    role: 'reader',
    systemPrompt: READER_SYSTEM_PROMPT,
    prompt: buildReaderPrompt(text, page.url, ctx.programHint),
    schema: ExtractionSchema,
    temperature: 0,
    userId: ctx.userId ?? 'dev',
  });
  return {
    extraction: verifyExtractionEvidence(text, result.data as Extraction),
    costUsd: result.costUsd,
    usage: result.usage
      ? { model: result.model, inputTokens: result.usage.prompt_tokens, outputTokens: result.usage.completion_tokens }
      : undefined,
  };
}

async function defaultReadPdf(url: string) {
  const { bytes } = await fetchBytes(url);
  return readPdfText(bytes);
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

/** request_approval: persist state and halt with needs_approval. */
export function requestApproval(gate: PendingGate['gate'], what: string, evidence: unknown, options: unknown): StepOutcome {
  return { events: [], gate: { gate, what, evidence, options } };
}

function readMemory(run: RunRecord): DeepScanMemory | null {
  const mem = (run.state as Record<string, unknown>)['deepScan'];
  if (!mem || typeof mem !== 'object') return null;
  return mem as DeepScanMemory;
}

function writeMemory(run: RunRecord, mem: DeepScanMemory): void {
  (run.state as Record<string, unknown>)['deepScan'] = mem;
}

function buildFinish(mem: DeepScanMemory): FinishResult {
  const best = [...mem.extractions].sort((a, b) => b.deadlines.length - a.deadlines.length)[0] ?? null;
  return FinishSchema.parse({
    programUrl: mem.programUrl,
    pagesRead: mem.pages,
    unreadable: mem.unreadable,
    deadlinesFound: mem.extractions.reduce((n, e) => n + e.deadlines.length, 0),
    extraction: mem.reconciled ?? best,
    conflicts: mem.conflicts,
    error: null,
    summary: mem.summary,
    usage: mem.calls,
    usageUsd: mem.usageUsd,
  });
}

function parseArgs(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false } {
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === 'object') return { ok: true, value: value as Record<string, unknown> };
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export function createDeepScanStep(tools: DeepScanTools = {}): import('../agent/advance.js').StepFn {
  const fetchPage = tools.fetchPage ?? fetchPageText;
  const readPdf = tools.readPdf ?? defaultReadPdf;
  const readPage = tools.readPage ?? defaultReadPage;
  const model = tools.model ?? defaultTransport;
  const judge = tools.judge ?? defaultJudge;
  const maxPages = tools.maxPages ?? MAX_SCAN_PAGES;
  const maxDepth = tools.maxDepth ?? MAX_SCAN_DEPTH;

  return async (run) => {
    const turn = run.turnCount;
    const events: RunEvent[] = [];
    const say = (label: string, state: 'active' | 'done' | 'failed' = 'active') => {
      const event: RunEvent = { t: 'status', id: `${run.id}-t${turn}-${events.length}`, label, state };
      events.push(event);
    };
    const userId = typeof run.userId === 'string' ? run.userId : undefined;

    const logTool = (entry: Omit<UsageEntry, 'turn'>) => {
      const mem = readMemory(run);
      mem?.calls.push({ ...entry, turn });
    };

    let mem = readMemory(run);
    if (!mem) {
      const state = run.state as Record<string, unknown>;
      const programUrl = typeof state['programUrl'] === 'string' ? (state['programUrl'] as string) : null;
      if (!programUrl) {
        return requestApproval('G1', 'Is this the right program?', null, null);
      }
      mem = {
        programUrl,
        programHint: typeof state['programHint'] === 'string' ? (state['programHint'] as string) : null,
        opportunityType: typeof state['opportunityType'] === 'string' ? (state['opportunityType'] as string) : undefined,
        institution: typeof state['institution'] === 'string' ? (state['institution'] as string) : undefined,
        queue: [],
        seen: [programUrl],
        depths: { [programUrl]: 0 },
        pages: [],
        unreadable: [],
        extractions: [],
        reconciled: null,
        conflicts: [],
        g2Asked: false,
        usageUsd: 0,
        calls: [],
        responseId: null,
        pending: [],
        summary: null,
        errors: 0,
        started: false,
      };
      writeMemory(run, mem);
    }

    if (!mem.started) {
      say(SAY_ON_IT);
      mem.started = true;
    }

    const coveragePayload = () => {
      const languages = [...new Set(mem.extractions.map((e) => e.program.language_read).filter((l) => typeof l === 'string' && l.trim() !== ''))];
      return buildCoveragePayload({ pagesRead: mem.pages, unreadable: mem.unreadable, languages });
    };

    const pushCoverageCard = (): void => {
      events.push({ t: 'card', id: `${run.id}-t${turn}-coverage`, kind: 'coverage', payload: coveragePayload() });
    };

    // Post-resume: the human answered the G2 conflict question. The
    // reconciled result is already stored — finish instead of re-asking.
    if (mem.g2Asked) {
      mem.g2Asked = false;
      writeMemory(run, mem);
      pushCoverageCard();
      say(SAY_GOT_IT, 'done');
      return { events, finished: buildFinish(mem) };
    }

    /** Merge every page read; judge genuine conflicts; G2 when they stand. */
    const settle = async (): Promise<StepOutcome> => {
      const pairs: ReconcilePage[] = mem.pages
        .map((p, i) => ({ url: p.url, title: p.title, extraction: mem.extractions[i] }))
        .filter((p): p is ReconcilePage => Boolean(p.extraction));
      const { merged, conflicts } = reconcileExtractions(pairs, mem.programUrl);
      let active = merged;
      let remaining = conflicts;
      if (merged && conflicts.length > 0) {
        try {
          const res = await resolveConflictsWithJudge(merged, conflicts, judge, userId);
          active = res.merged;
          remaining = res.remaining;
          mem.usageUsd += res.costUsd;
          run.usageUsd = (typeof run.usageUsd === 'number' ? run.usageUsd : 0) + res.costUsd;
          mem.calls.push({
            turn,
            kind: 'model',
            tool: null,
            role: 'judge',
            model: res.judgeUsage?.model ?? null,
            inputTokens: res.judgeUsage?.inputTokens ?? null,
            outputTokens: res.judgeUsage?.outputTokens ?? null,
            costUsd: res.costUsd,
          });
        } catch (err) {
          if (err instanceof BudgetExceededError) {
            say(SAY_BUDGET_HIT, 'failed');
            writeMemory(run, mem);
            return { events, finished: { ...buildFinish(mem), error: 'budget hit' } };
          }
          // Judge unreachable: fall through with code-detected conflicts.
        }
      }
      mem.reconciled = active;
      mem.conflicts = remaining;
      const coverage = coveragePayload();
      events.push({ t: 'card', id: `${run.id}-t${turn}-coverage`, kind: 'coverage', payload: coverage });
      if (remaining.length > 0) {
        mem.g2Asked = true;
        writeMemory(run, mem);
        return {
          events,
          gate: {
            gate: 'G2',
            what: formatG2Conflict(remaining.map((c) => c.field)),
            evidence: { conflicts: remaining, coverage },
            options: null,
          },
        };
      }
      say(SAY_GOT_IT, 'done');
      writeMemory(run, mem);
      return { events, finished: buildFinish(mem) };
    };

    if (mem.pages.length >= maxPages) {
      return settle();
    }

    const finishWithError = (reason: string): StepOutcome => {
      say(SAY_PAGE_WOULD_NOT_OPEN, 'failed');
      writeMemory(run, mem as DeepScanMemory);
      return {
        events,
        finished: { ...buildFinish(mem as DeepScanMemory), error: reason },
      };
    };

    // One model decision per turn.
    let transport: Awaited<ReturnType<ModelTransport>>;
    try {
      const input =
        mem.pending.length > 0
          ? mem.pending.map((p) => ({ type: 'function_call_output', call_id: p.callId, output: p.output }))
          : buildOrchestratorContext({
              programUrl: mem.programUrl,
              programHint: mem.programHint,
              pagesRead: mem.pages,
              unreadable: mem.unreadable,
              maxPages,
              maxDepth,
              turnsLeft: Math.max(0, DEFAULT_MAX_TURNS - turn),
            });
      mem.pending = [];
      transport = await model({
        systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
        input,
        tools: TOOL_DEFS,
        previousResponseId: mem.responseId,
        userId,
        turn,
      });
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        say(SAY_BUDGET_HIT, 'failed');
        writeMemory(run, mem);
        return { events, finished: { ...buildFinish(mem), error: 'budget hit' } };
      }
      mem.errors += 1;
      writeMemory(run, mem);
      if (mem.errors >= 3) return finishWithError('orchestrator unreachable');
      return { events };
    }
    mem.errors = 0;
    mem.responseId = transport.responseId || null;
    mem.calls.push({
      turn,
      kind: 'model',
      tool: null,
      role: 'orchestrator',
      model: transport.model,
      inputTokens: transport.inputTokens,
      outputTokens: transport.outputTokens,
      costUsd: transport.costUsd,
    });
    run.usageUsd = (typeof run.usageUsd === 'number' ? run.usageUsd : 0) + transport.costUsd;

    if (transport.calls.length === 0) {
      // No tool calls: prose ends the scan (empty text is covered too).
      mem.summary = transport.text.length > 0 ? transport.text.slice(0, 500) : mem.summary;
      return settle();
    }

    let sawReading = false;
    let sawFinding: string | null = null;
    let sawUnreadable = false;

    for (const call of transport.calls) {
      const parsed = parseArgs(call.args);
      const out = (value: unknown) => {
        mem!.pending.push({ callId: call.callId, output: JSON.stringify(value).slice(0, 8000) });
      };
      if (!parsed.ok) {
        out({ error: 'bad arguments: not a JSON object' });
        continue;
      }
      const args = parsed.value;
      const str = (v: unknown) => (typeof v === 'string' ? v : null);

      if (call.name === 'request_approval') {
        const gate = str(args['gate']);
        const what = str(args['what']);
        if (gate !== 'G1' && gate !== 'G2' && gate !== 'G3' && gate !== 'G4' && gate !== 'G5') {
          out({ error: 'unknown gate' });
          continue;
        }
        writeMemory(run, mem);
        const outcome = requestApproval(gate, what ?? 'Confirm to continue.', args['evidence'] ?? null, args['options'] ?? null);
        return { events: [...events, ...outcome.events], gate: outcome.gate };
      }

      if (call.name === 'finish') {
        const summary = str(args['summary']);
        mem.summary = summary ? summary.slice(0, 500) : mem.summary;
        writeMemory(run, mem);
        return settle();
      }

      if (call.name === 'find_links') {
        const pageUrl = str(args['page_url']);
        if (!pageUrl || !sameSite(mem.programUrl, pageUrl)) {
          out({ error: 'off-site or invalid URL; same official site only' });
          continue;
        }
        try {
          const page = await fetchPage(pageUrl);
          const parentDepth = mem.depths[pageUrl] ?? 0;
          const ranked = rankLinks(pageUrl, page.links.map((l) => ({ href: l.href, text: l.text })), {
            programHint: mem.programHint,
          });
          for (const link of ranked) {
            if (!(link.url in mem.depths)) mem.depths[link.url] = parentDepth + 1;
          }
          logTool({ kind: 'tool', tool: 'find_links', role: null, model: null, inputTokens: null, outputTokens: null, costUsd: 0 });
          sawFinding = sawFinding ?? pageUrl;
          out({ links: ranked.map((r) => ({ url: r.url, text: r.text })) });
        } catch (err) {
          out({ error: err instanceof Error ? err.message : 'fetch failed' });
        }
        continue;
      }

      if (call.name === 'fetch_page' || call.name === 'read_pdf' || call.name === 'read_page') {
        const url = str(args['url']);
        if (!url || !sameSite(mem.programUrl, url)) {
          out({ error: 'off-site or invalid URL; same official site only' });
          continue;
        }
        const depth = mem.depths[url] ?? (url === mem.programUrl ? 0 : maxDepth + 1);
        if (depth > maxDepth) {
          out({ error: `beyond the depth-${maxDepth} cap` });
          continue;
        }
        if (call.name === 'read_page' && mem.pages.length >= maxPages) {
          out({ error: 'page budget exhausted; call finish' });
          continue;
        }

        if (call.name === 'fetch_page') {
          try {
            const page = await fetchPage(url);
            logTool({ kind: 'tool', tool: 'fetch_page', role: null, model: null, inputTokens: null, outputTokens: null, costUsd: 0 });
            sawFinding = sawFinding ?? url;
            out({ title: page.title, chars: page.text.length, snippet: page.text.slice(0, 800), linksFound: page.links.length });
          } catch (err) {
            if (err instanceof PdfContentError) out({ isPdf: true, hint: 'use read_pdf for this URL' });
            else out({ error: err instanceof Error ? err.message : 'fetch failed' });
          }
          continue;
        }

        if (call.name === 'read_pdf') {
          try {
            const pdf = await readPdf(url);
            logTool({ kind: 'tool', tool: 'read_pdf', role: null, model: null, inputTokens: null, outputTokens: null, costUsd: 0 });
            sawFinding = sawFinding ?? url;
            out(pdf.readable ? { readable: true, chars: pdf.text.length, snippet: pdf.text.slice(0, 800) } : { readable: false, reason: pdf.reason });
          } catch (err) {
            out({ error: err instanceof Error ? err.message : 'pdf fetch failed' });
          }
          continue;
        }

        // read_page
        try {
          const page = await fetchPage(url);
          let text = page.text;
          if (text.length === 0) {
            const pdf = await readPdf(url);
            if (!pdf.readable) {
              mem.unreadable.push({ url, reason: pdf.reason });
              sawUnreadable = true;
              out({ error: pdf.reason });
              continue;
            }
            text = pdf.text;
          }
          const result = await readPage({ url, title: page.title || url, text }, { programHint: mem.programHint, opportunityType: mem.opportunityType, userId });
          mem.usageUsd += result.costUsd;
          run.usageUsd = (typeof run.usageUsd === 'number' ? run.usageUsd : 0) + result.costUsd;
          mem.calls.push({
            turn,
            kind: 'tool',
            tool: 'read_page',
            role: 'reader',
            model: result.usage?.model ?? null,
            inputTokens: result.usage?.inputTokens ?? null,
            outputTokens: result.usage?.outputTokens ?? null,
            costUsd: result.costUsd,
          });
          mem.extractions.push(result.extraction);
          mem.pages.push({ url, title: page.title || url });
          sawReading = true;
          out({ deadlines: result.extraction.deadlines.length, title: page.title || url });
        } catch (err) {
          if (err instanceof BudgetExceededError) {
            say(SAY_BUDGET_HIT, 'failed');
            writeMemory(run, mem);
            return { events, finished: { ...buildFinish(mem), error: 'budget hit' } };
          }
          const reason = err instanceof Error ? err.message : 'reader failed';
          mem.unreadable.push({ url, reason });
          sawUnreadable = true;
          out({ error: reason });
        }
        continue;
      }

      out({ error: `unknown tool: ${call.name}` });
    }

    if (sawReading) say(formatReadingStatus(mem.opportunityType ?? 'generic_opportunity', mem.institution));
    else if (sawFinding) say(formatFindingStatus(sawFinding));
    if (sawUnreadable) say(SAY_PAGE_WOULD_NOT_OPEN, 'failed');
    writeMemory(run, mem);
    return { events };
  };
}
