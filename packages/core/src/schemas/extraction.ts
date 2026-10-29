import { z } from 'zod';

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);

export const OpportunityTypeSchema = z.enum([
  "academic_program",
  "job",
  "fellowship",
  "grant",
  "competition",
  "hackathon",
  "scholarship",
  "incubator",
  "generic_opportunity",
]);

export type OpportunityType = z.infer<typeof OpportunityTypeSchema>;

export const EvidencedSchema = <T extends z.ZodTypeAny>(v: T) => z.object({
  value: v,
  evidence_quote: z.string().max(400),
  source_url: z.string(),          // upload id for flyers, "user-pasted" for pasted text
  confidence: ConfidenceSchema,
  needs_human: z.boolean().default(false),
  checked: z.boolean().default(false), // set by the evidence post-check
});

export const EvidencedStringSchema = EvidencedSchema(z.string());

export type EvidencedString = z.infer<typeof EvidencedStringSchema>;

export const DateFieldSchema = EvidencedSchema(z.object({
  iso_utc: z.string().nullable(),     // always UTC
  original_tz: z.string().nullable(), // IANA zone, or null if unstated
  all_day: z.boolean(),
  rolling: z.boolean().default(false),
}));

export const ExtractionSchema = z.object({
  opportunity_type: OpportunityTypeSchema,
  program: z.object({
    name: EvidencedStringSchema, // Role title, Program name, Grant title, or Challenge name
    unit: EvidencedStringSchema, // Division, Department, Team, or Track
    institution: EvidencedStringSchema, // Company, University, Foundation, Host, or Sponsor
    portal_url: z.string().nullable(),
    language_read: z.string(),
  }),
  opens: DateFieldSchema.nullable(), // null means not published
  deadlines: z.array(z.object({ label: z.string(), field: DateFieldSchema })),
  documents: z.array(EvidencedSchema(z.object({
    name: z.string(),
    limit: z.string().nullable(),
    optional: z.boolean(),
  }))),
  eligibility: z.array(EvidencedSchema(z.object({ rule: z.string(), hard: z.boolean() }))),
  people: z.array(EvidencedSchema(z.string())),
  tests: z.array(EvidencedSchema(z.string())),
  money: z.array(EvidencedSchema(z.string())),
  unusual_rules: z.array(EvidencedSchema(z.string())), // anything that changes eligibility, a deadline, a document, a cost or who to contact
});

export type Confidence = z.infer<typeof ConfidenceSchema>;
export type DateField = z.infer<typeof DateFieldSchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;
