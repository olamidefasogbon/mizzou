import { z } from 'zod';
import type { Extraction } from '../schemas/extraction.js';

// Code reconcile for the deep scan (PROMPT.md 6.3 step 5 + 6.5).
// Merge rule: the confirmed program page wins (program over department over
// graduate school); anything else first-seen wins. A genuine disagreement —
// same deadline label with different dates, a different opening date, or the
// same eligibility rule with a different hard flag — is a Conflict: both
// values are flagged needs_human and surfaced at G2 with both sources. The
// judge role adjudicates only these conflicts (resolveConflictsWithJudge);
// clean merges never cost a model call.

export const ConflictValueSchema = z.object({
  iso: z.string().nullable(),
  quote: z.string(),
  source_url: z.string(),
});

export const ConflictSchema = z.object({
  field: z.string(),
  values: z.array(ConflictValueSchema),
});

export type Conflict = z.infer<typeof ConflictSchema>;

export interface ReconcilePage {
  url: string;
  title: string;
  extraction: Extraction;
}

export interface ReconcileResult {
  merged: Extraction | null;
  conflicts: Conflict[];
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function markNeedsHuman(field: { needs_human: boolean; confidence: 'high' | 'medium' | 'low' }): void {
  field.needs_human = true;
  if (field.confidence === 'high') field.confidence = 'medium';
}

/** Merge extractions from every page read; collect genuine disagreements. */
export function reconcileExtractions(pages: ReconcilePage[], programUrl: string): ReconcileResult {
  if (pages.length === 0) return { merged: null, conflicts: [] };
  const ordered = [...pages].sort((a, b) => {
    if (a.url === programUrl) return -1;
    if (b.url === programUrl) return 1;
    return 0;
  });
  const merged = clone(ordered[0].extraction);
  const conflicts: Conflict[] = [];

  // Deadlines: same label must carry the same instant.
  const byLabel = new Map<string, { iso: string | null; quote: string; source_url: string; index: number }>();
  merged.deadlines.forEach((d, i) => {
    byLabel.set(norm(d.label), { iso: d.field.value.iso_utc, quote: d.field.evidence_quote, source_url: d.field.source_url, index: i });
  });
  for (const page of ordered.slice(1)) {
    for (const d of page.extraction.deadlines) {
      const key = norm(d.label);
      const seen = byLabel.get(key);
      if (!seen) {
        byLabel.set(key, { iso: d.field.value.iso_utc, quote: d.field.evidence_quote, source_url: d.field.source_url, index: merged.deadlines.length });
        merged.deadlines.push(clone(d));
        continue;
      }
      if (seen.iso !== d.field.value.iso_utc) {
        const field = `deadlines:${d.label}`;
        if (!conflicts.some((c) => c.field === field)) {
          conflicts.push({
            field,
            values: [
              { iso: seen.iso, quote: seen.quote, source_url: seen.source_url },
              { iso: d.field.value.iso_utc, quote: d.field.evidence_quote, source_url: d.field.source_url },
            ],
          });
        }
        markNeedsHuman(merged.deadlines[seen.index].field);
        const flagged = clone(d);
        markNeedsHuman(flagged.field);
        merged.deadlines.push(flagged);
      }
    }
  }

  // Opens: the program page wins; a different published date is a conflict.
  for (const page of ordered.slice(1)) {
    const other = page.extraction.opens;
    if (!other || other.value.iso_utc === null) continue;
    if (!merged.opens || merged.opens.value.iso_utc === null) {
      merged.opens = clone(other);
      continue;
    }
    if (merged.opens.value.iso_utc !== other.value.iso_utc) {
      const field = 'opens';
      if (!conflicts.some((c) => c.field === field)) {
        conflicts.push({
          field,
          values: [
            { iso: merged.opens.value.iso_utc, quote: merged.opens.evidence_quote, source_url: merged.opens.source_url },
            { iso: other.value.iso_utc, quote: other.evidence_quote, source_url: other.source_url },
          ],
        });
      }
      markNeedsHuman(merged.opens);
    }
  }

  // Eligibility: same rule text with a different hard flag is a conflict.
  const rules = new Map<string, number>();
  merged.eligibility.forEach((e, i) => {
    rules.set(norm(e.value.rule), i);
  });
  for (const page of ordered.slice(1)) {
    for (const e of page.extraction.eligibility) {
      const key = norm(e.value.rule);
      const at = rules.get(key);
      if (at === undefined) {
        rules.set(key, merged.eligibility.length);
        merged.eligibility.push(clone(e));
        continue;
      }
      if (merged.eligibility[at].value.hard !== e.value.hard) {
        const field = `eligibility:${e.value.rule}`;
        if (!conflicts.some((c) => c.field === field)) {
          conflicts.push({
            field,
            values: [
              { iso: null, quote: merged.eligibility[at].evidence_quote, source_url: merged.eligibility[at].source_url },
              { iso: null, quote: e.evidence_quote, source_url: e.source_url },
            ],
          });
        }
        markNeedsHuman(merged.eligibility[at]);
      }
    }
  }

  // Documents, people, tests, money, unusual rules: union by value text.
  const seenDoc = new Set(merged.documents.map((d) => norm(JSON.stringify(d.value))));
  for (const page of ordered.slice(1)) {
    for (const d of page.extraction.documents) {
      const key = norm(JSON.stringify(d.value));
      if (!seenDoc.has(key)) {
        seenDoc.add(key);
        merged.documents.push(clone(d));
      }
    }
  }
  for (const section of ['people', 'tests', 'money', 'unusual_rules'] as const) {
    const seen = new Set(merged[section].map((e) => norm(typeof e.value === 'string' ? e.value : JSON.stringify(e.value))));
    for (const page of ordered.slice(1)) {
      for (const e of page.extraction[section]) {
        const key = norm(typeof e.value === 'string' ? e.value : JSON.stringify(e.value));
        if (!seen.has(key)) {
          seen.add(key);
          (merged[section] as unknown[]).push(clone(e));
        }
      }
    }
  }

  return { merged, conflicts };
}

export const JudgeVerdictSchema = z.object({
  resolutions: z.array(z.object({
    field: z.string(),
    chosen_iso: z.string().nullable(),
    reason: z.string().max(280),
  })),
});

export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

export interface JudgeCall {
  verdict: JudgeVerdict;
  costUsd: number;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export type JudgeTransport = (args: {
  conflicts: Conflict[];
  userId?: string;
}) => Promise<JudgeCall>;

/**
 * Ask the judge to adjudicate code-detected conflicts. A resolution rewrites
 * the merged value and clears needs_human; anything the judge leaves alone
 * (or that fails validation) stays flagged for G2 with both sources.
 */
export async function resolveConflictsWithJudge(
  merged: Extraction,
  conflicts: Conflict[],
  judge: JudgeTransport,
  userId?: string,
): Promise<{ merged: Extraction; remaining: Conflict[]; costUsd: number; judgeUsage?: { model: string; inputTokens: number; outputTokens: number } }> {
  if (conflicts.length === 0) return { merged, remaining: [], costUsd: 0 };
  const out = clone(merged);
  let call: JudgeCall;
  try {
    call = await judge({ conflicts, userId });
  } catch {
    return { merged: out, remaining: conflicts, costUsd: 0 };
  }
  const parsed = JudgeVerdictSchema.safeParse(call.verdict);
  if (!parsed.success) return { merged: out, remaining: conflicts, costUsd: call.costUsd };
  const remaining: Conflict[] = [];
  for (const conflict of conflicts) {
    const resolution = parsed.data.resolutions.find((r) => r.field === conflict.field);
    if (!resolution || resolution.chosen_iso === null) {
      remaining.push(conflict);
      continue;
    }
    if (!conflict.values.some((v) => v.iso === resolution.chosen_iso)) {
      remaining.push(conflict);
      continue;
    }
    if (conflict.field === 'opens') {
      if (out.opens) {
        out.opens.value.iso_utc = resolution.chosen_iso;
        out.opens.needs_human = false;
      }
      continue;
    }
    if (conflict.field.startsWith('deadlines:')) {
      const label = norm(conflict.field.slice('deadlines:'.length));
      const kept = out.deadlines.filter(
        (d) => norm(d.label) !== label || d.field.value.iso_utc === resolution.chosen_iso,
      );
      const dropped = out.deadlines.length - kept.length;
      out.deadlines = kept.map((d) => {
        if (norm(d.label) === label) d.field.needs_human = false;
        return d;
      });
      if (dropped === 0) {
        remaining.push(conflict);
        continue;
      }
      continue;
    }
    remaining.push(conflict);
  }
  return {
    merged: out,
    remaining,
    costUsd: call.costUsd,
    judgeUsage: call.model && call.inputTokens !== undefined && call.outputTokens !== undefined
      ? { model: call.model, inputTokens: call.inputTokens, outputTokens: call.outputTokens }
      : undefined,
  };
}
