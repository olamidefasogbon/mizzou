// Writer role for drafts (PROMPT.md 7.5). The writer drafts from the
// confirmed profile facts and the program's own wording. Missing facts
// become [PLACEHOLDER]: the writer never invents facts about the user or
// the program, and never helps misstate credentials. Chat edits rewrite the
// current body in place; versions are kept by the caller, latest wins.
import { z } from 'zod';

export const DRAFT_KINDS = ['statement', 'email', 'answer'] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export function isDraftKind(v: unknown): v is DraftKind {
  return v === 'statement' || v === 'email' || v === 'answer';
}

export const DraftSchema = z.object({
  body: z.string().min(1),
});

export type Draft = z.infer<typeof DraftSchema>;

export interface WriterProfileFact {
  question: string;
  answer: string;
}

export interface WriterCreateInput {
  kind: DraftKind;
  title: string;
  profile: WriterProfileFact[];
  program: string;
  instructions: string | null;
}

export interface WriterEditInput {
  kind: DraftKind;
  title: string;
  profile: WriterProfileFact[];
  program: string;
  current: string;
  instruction: string;
}

export const WRITER_SYSTEM_PROMPT =
  'You draft application materials in the applicant\u2019s own voice: plain words, short sentences, no jargon, no flattery. Return only JSON matching the schema: {"body": string}. Use ONLY the stated profile facts and the program wording given: never invent degrees, grades, jobs, dates, or documents. Anything the profile does not state becomes [PLACEHOLDER]. Never suggest overstating or hiding anything.';

export function buildWriterPrompt(input: WriterCreateInput): string {
  const lines = [
    'Draft this application material and return ONLY one JSON object: {"body": string (the full draft text)}. Use [PLACEHOLDER] for any fact the profile does not state.',
    `KIND: ${input.kind}`,
    `TITLE: ${input.title}`,
    `PROGRAM: ${input.program}`,
    `PROFILE (question and answer): ${JSON.stringify(input.profile)}`,
  ];
  if (input.instructions) lines.push(`INSTRUCTIONS: ${input.instructions}`);
  return lines.join('\n');
}

export function buildWriterEditPrompt(input: WriterEditInput): string {
  return [
    'Rewrite the draft below following ONLY the edit instruction, and return ONLY one JSON object: {"body": string (the full revised draft)}. Keep every stated fact; keep [PLACEHOLDER] wherever the profile is still silent; never invent or overstate anything.',
    `KIND: ${input.kind}`,
    `TITLE: ${input.title}`,
    `PROGRAM: ${input.program}`,
    `PROFILE (question and answer): ${JSON.stringify(input.profile)}`,
    `EDIT INSTRUCTION: ${input.instruction}`,
    `CURRENT DRAFT:\n${input.current}`,
  ].join('\n');
}
