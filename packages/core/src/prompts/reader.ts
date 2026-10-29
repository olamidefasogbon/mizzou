// Versioned system prompts (PROMPT.md: every system prompt lives here).
// The reader turns one page of text into the extraction schema. The eval
// harness and the chat route import this module too — one source of truth.

export const READER_SYSTEM_PROMPT =
  'You read one official admissions page into the extraction schema. Return only JSON matching the schema.';

export function buildReaderPrompt(pageText: string, sourceUrl: string, programHint?: string | null): string {
  return (
    `Extract application facts from the page text below. Return ONLY one JSON object with EXACTLY this structure ` +
    `(all keys present; null or [] where nothing is found; never guess a date):\n` +
    (programHint
      ? `Confirmed program context (post-G1): extract ALL deadlines on the page, and make sure the deadline for "${programHint}" is included with an exact evidence quote.\n`
      : '') +
    `When a date appears as a heading above the item it governs (for example a "January 2, 2027" heading over a program list), include that heading in the evidence_quote so the quote carries the full date.\n` +
    `{"opportunity_type": one of [academic_program|job|fellowship|grant|competition|hackathon|scholarship|incubator|generic_opportunity] — classify what the page offers,\n` +
    ` "program": {"name": EV_STR, "unit": EV_STR, "institution": EV_STR, "portal_url": string|null, "language_read": string},\n` +
    ` "opens": DATEFIELD|null,\n` +
    ` "deadlines": [{"label": string, "field": DATEFIELD}],\n` +
    ` "documents": [{"value": {"name": string, "limit": string|null, "optional": boolean}, "evidence_quote": string, "confidence": CONF, "needs_human": boolean, "checked": boolean}],\n` +
    ` "eligibility": [{"value": {"rule": string, "hard": boolean}, "evidence_quote": string, "confidence": CONF, "needs_human": boolean, "checked": boolean}],\n` +
    ` "people": [EV_STR], "tests": [EV_STR], "money": [EV_STR], "unusual_rules": [EV_STR]}\n` +
    `where EV_STR = {"value": string, "evidence_quote": string (max 400 chars, copied verbatim from the page text, must support the value), "source_url": string (always "${sourceUrl}"), "confidence": CONF, "needs_human": boolean, "checked": boolean},\n` +
    `CONF = "high"|"medium"|"low", and DATEFIELD = {"value": {"iso_utc": string|null (UTC as YYYY-MM-DDTHH:MM:SSZ), "original_tz": string|null, "all_day": boolean, "rolling": boolean}, "evidence_quote": string, "source_url": string, "confidence": CONF, "needs_human": boolean, "checked": boolean}.\n` +
    `PAGE TEXT:\n${pageText}`
  );
}
