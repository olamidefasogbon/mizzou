// Judge prompt for the deep-scan reconcile step (PROMPT.md 6.5 + 7.2).
// The code merge in extract/reconcile.ts handles the common case; the judge
// adjudicates only genuine conflicts (same label, different dates) so the
// scan pays for one extra model call only when the pages disagree.

export const JUDGE_SYSTEM_PROMPT =
  'You adjudicate conflicting application facts extracted from official pages. Return only JSON matching the schema.';

export function buildJudgePrompt(conflicts: Array<{ field: string; values: Array<{ iso: string | null; quote: string; source_url: string }> }>): string {
  return (
    `Two or more official pages disagree on the same application fact. For each conflict, pick the winning value or leave it unresolved when neither source clearly wins (a program page beats a department page, which beats a graduate-school page; a dated update beats an older one).\n` +
    `Return ONLY one JSON object: {"resolutions": [{"field": string (exactly as given), "chosen_iso": string|null (the winning iso_utc value, or null when nothing wins), "reason": string (one sentence)}]}.\n` +
    `CONFLICTS:\n${JSON.stringify(conflicts)}`
  );
}
