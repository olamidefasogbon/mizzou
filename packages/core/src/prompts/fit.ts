// Judge-role fit read (PROMPT.md 7.2). The judge returns an internal-only
// object: matched criteria, hard-rule gaps, competitive gaps, the single
// biggest risk, each gap citing the extraction field it comes from. No
// score, no numbers anywhere: the UI card speaks in plain words and this
// object never leaves the server. It never helps misstate the user's
// credentials: where the profile is silent the read says what is missing
// instead of guessing, and gaps stay gaps.
import { z } from 'zod';

export const FitGapSchema = z.object({
  /** Extraction field the gap comes from (for example "eligibility: minimum GPA"). */
  field: z.string(),
  /** One plain-words sentence. No scores, no percentages, no amounts. */
  note: z.string(),
});

export type FitGap = z.infer<typeof FitGapSchema>;

export const FitAssessmentSchema = z.object({
  matched: z.array(z.string()),
  hard_gaps: z.array(FitGapSchema),
  competitive_gaps: z.array(FitGapSchema),
  biggest_risk: z.string(),
});

export type FitAssessment = z.infer<typeof FitAssessmentSchema>;

export interface FitAssessmentInput {
  program: string;
  rules: Array<{ rule: string; hard: boolean }>;
  documents: Array<{ name: string; optional: boolean }>;
  profile: Array<{ question: string; answer: string }>;
}

export const FIT_JUDGE_SYSTEM_PROMPT =
  'You give an honest fit read of an application opportunity against the applicant\u2019s own stated profile facts. Return only JSON matching the schema. Compare ONLY against the stated profile facts: never invent background, grades, or documents the profile does not mention. Where the profile is silent on something the opportunity needs, say what is missing instead of guessing. Gaps stay gaps: never suggest overstating or hiding anything. No scores, no percentages, no amounts anywhere in the output.';

export function buildFitPrompt(input: FitAssessmentInput): string {
  const lines = [
    'Read this opportunity against this applicant profile and return ONLY one JSON object:',
    '{"matched": string[] (criteria the stated profile clearly meets, one plain-words line each),',
    ' "hard_gaps": [{"field": string (the extraction field, e.g. "eligibility: minimum GPA"), "note": string (one plain-words sentence)}],',
    ' "competitive_gaps": [{"field": string, "note": string}] (softer stretches: experience, cohort strength, optional items),',
    ' "biggest_risk": string (the single biggest reason this might not work out, one plain-words sentence)}.',
    `PROGRAM: ${input.program}`,
    `RULES: ${JSON.stringify(input.rules)}`,
    `DOCUMENTS: ${JSON.stringify(input.documents)}`,
    `PROFILE (question and answer): ${JSON.stringify(input.profile)}`,
  ];
  return lines.join('\n');
}
