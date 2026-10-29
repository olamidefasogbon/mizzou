// Tool-calling deep-scan orchestrator (PROMPT.md section 5.1 + 6.5).
// One page per turn so advance() caps, budgets and resume apply as-is.
// Tools: find_links (rankLinks, code only), fetch_page (fetchPageText),
// read_pdf (fetchBytes + readPdfText), read_page (reader role + post-check),
// request_approval (gate halt), finish (zod-validated result).
// Status lines come from the voice module. No model calls except read_page.

import { z } from 'zod';
import type { StepFn, StepOutcome } from '../agent/advance.js';
import type { PendingGate, RunRecord } from '../agent/types.js';
import { BudgetExceededError } from '../meta/budget.js';
import { callModel } from '../meta/callModel.js';
import { ExtractionSchema, type Extraction } from '../schemas/extraction.js';
import type { RunEvent } from '../schemas/events.js';
import { verifyExtractionEvidence } from '../extract/evidence.js';
import { READER_SYSTEM_PROMPT, buildReaderPrompt } from '../prompts/reader.js';
import {
  SAY_BUDGET_HIT,
  SAY_GOT_IT,
  SAY_ON_IT,
  SAY_PAGE_WOULD_NOT_OPEN,
  formatFindingStatus,
  formatReadingStatus,
} from '../voice/index.js';
import { PdfContentError, fetchBytes, fetchPageText, type OutboundLink } from './fetch.js';
import { rankLinks } from './rank.js';
import { readPdfText } from './pdf.js';

/** Section 5.1 caps. */
export const MAX_SCAN_PAGES = 25;
export const MAX_SCAN_DEPTH = 2;

export const FinishSchema = z.object({
  programUrl: z.string(),
  pagesRead: z.array(z.object({ url: z.string(), title: z.string() })),
  unreadable: z.array(z.object({ url: z.string(), reason: z.string() })),
  deadlinesFound: z.number(),
  extraction: ExtractionSchema.nullable(),
  error: z.string().nullable(),
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
  pages: Array<{ url: string; title: string }>;
  unreadable: Array<{ url: string; reason: string }>;
  extractions: Extraction[];
  usageUsd: number;
  started: boolean;
}

export interface ReadPageResult {
  extraction: Extraction;
  costUsd: number;
}

export interface DeepScanTools {
  fetchPage?: (url: string) => Promise<{ title: string; text: string; links: OutboundLink[] }>;
  readPdf?: (url: string) => Promise<{ readable: true; text: string } | { readable: false; reason: string }>;
  readPage?: (
    page: { url: string; title: string; text: string },
    ctx: { programHint: string | null; opportunityType?: string; userId?: string },
  ) => Promise<ReadPageResult>;
  maxPages?: number;
  maxDepth?: number;
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
  };
}

async function defaultReadPdf(url: string) {
  const { bytes } = await fetchBytes(url);
  return readPdfText(bytes);
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
    extraction: best,
    error: null,
    usageUsd: mem.usageUsd,
  });
}

export function createDeepScanStep(tools: DeepScanTools = {}): StepFn {
  const fetchPage = tools.fetchPage ?? fetchPageText;
  const readPdf = tools.readPdf ?? defaultReadPdf;
  const readPage = tools.readPage ?? defaultReadPage;
  const maxPages = tools.maxPages ?? MAX_SCAN_PAGES;
  const maxDepth = tools.maxDepth ?? MAX_SCAN_DEPTH;

  return async (run) => {
    const turn = run.turnCount;
    const events: RunEvent[] = [];
    const say = (label: string, state: 'active' | 'done' | 'failed' = 'active') => {
      const event: RunEvent = { t: 'status', id: `${run.id}-t${turn}-${events.length}`, label, state };
      events.push(event);
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
        queue: [{ url: programUrl, depth: 0 }],
        seen: [programUrl],
        pages: [],
        unreadable: [],
        extractions: [],
        usageUsd: 0,
        started: false,
      };
      writeMemory(run, mem);
    }

    if (!mem.started) {
      say(SAY_ON_IT);
      mem.started = true;
    }

    // Next unread page within budget, else finish.
    const next = mem.queue.shift();
    if (!next || mem.pages.length >= maxPages) {
      say(SAY_GOT_IT, 'done');
      return { events, finished: buildFinish(mem) };
    }

    const userId = typeof run.userId === 'string' ? run.userId : undefined;
    say(formatFindingStatus(next.url));
    let title = next.url;
    let text = '';
    try {
      try {
        const page = await fetchPage(next.url);
        title = page.title || next.url;
        text = page.text;
        const ranked = rankLinks(
          next.url,
          page.links.map((l) => ({ href: l.href, text: l.text })),
          { programHint: mem.programHint },
        );
        for (const link of ranked) {
          if (mem.seen.includes(link.url)) continue;
          if (next.depth + 1 > maxDepth) break;
          if (mem.pages.length + mem.queue.length + 1 > maxPages) break;
          mem.seen.push(link.url);
          mem.queue.push({ url: link.url, depth: next.depth + 1 });
        }
      } catch (err) {
        if (err instanceof PdfContentError) {
          const pdf = await readPdf(next.url);
          if (!pdf.readable) throw new Error(pdf.reason);
          text = pdf.text;
        } else {
          throw err;
        }
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'fetch failed';
      mem.unreadable.push({ url: next.url, reason });
      say(SAY_PAGE_WOULD_NOT_OPEN, 'failed');
      writeMemory(run, mem);
      return { events };
    }

    say(formatReadingStatus(mem.opportunityType ?? 'generic_opportunity', mem.institution));
    try {
      const { extraction, costUsd } = await readPage(
        { url: next.url, title, text },
        { programHint: mem.programHint, opportunityType: mem.opportunityType, userId },
      );
      mem.usageUsd += costUsd;
      run.usageUsd = (typeof run.usageUsd === 'number' ? run.usageUsd : 0) + costUsd;
      mem.extractions.push(extraction);
      mem.pages.push({ url: next.url, title });
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        say(SAY_BUDGET_HIT, 'failed');
        writeMemory(run, mem);
        return {
          events,
          finished: { ...buildFinish(mem), error: 'budget hit' },
        };
      }
      mem.unreadable.push({ url: next.url, reason: err instanceof Error ? err.message : 'reader failed' });
      say(SAY_PAGE_WOULD_NOT_OPEN, 'failed');
      writeMemory(run, mem);
      return { events };
    }

    if (mem.queue.length === 0 || mem.pages.length >= maxPages) {
      say(SAY_GOT_IT, 'done');
      writeMemory(run, mem);
      return { events, finished: buildFinish(mem) };
    }
    writeMemory(run, mem);
    return { events };
  };
}
