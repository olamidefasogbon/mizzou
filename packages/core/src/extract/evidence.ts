import { Confidence, Extraction } from '../schemas/extraction.js';

interface EvidencedField {
  evidence_quote: string | null | undefined;
  confidence: Confidence;
  checked: boolean;
}

interface DateValue {
  iso_utc: string | null;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function verifyStringQuote(rawText: string, quote: string | null | undefined): boolean {
  if (!quote || normalize(quote).length === 0) return false;
  return normalize(rawText).includes(normalize(quote));
}

/**
 * Light value-support check: when an evidenced date carries an ISO value,
 * the quote must mention its year. Full date equality is verified by the
 * judge reconcile step; this keeps regex-free code honest about what it
 * proves.
 */
function quoteSupportsDate(quote: string, value: DateValue): boolean {
  if (value.iso_utc === null || value.iso_utc === undefined) return true;
  const year = value.iso_utc.slice(0, 4);
  if (!/^\d{4}$/.test(year)) return true;
  return normalize(quote).includes(year);
}

function checkField(
  rawText: string,
  field: EvidencedField,
  value?: DateValue,
): void {
  const quoteOk = verifyStringQuote(rawText, field.evidence_quote);
  const valueOk = value === undefined || field.evidence_quote === null
    ? true
    : quoteSupportsDate(field.evidence_quote ?? '', value);
  const valid = quoteOk && valueOk;
  field.checked = valid;
  if (!valid) field.confidence = 'low';
}

/**
 * Evidence post-check (code, no model) per PROMPT.md section 6.5: confirm
 * each evidence_quote appears in the fetched page text and that date values
 * are supported by their quote. Mismatches set confidence to low and checked
 * to false.
 */
export function verifyExtractionEvidence(rawSourceText: string, extraction: Extraction): Extraction {
  const result = JSON.parse(JSON.stringify(extraction)) as Extraction;

  checkField(rawSourceText, result.program.name);
  checkField(rawSourceText, result.program.unit);
  checkField(rawSourceText, result.program.institution);

  if (result.opens !== null) {
    checkField(rawSourceText, result.opens, result.opens.value);
  }

  for (const item of result.deadlines) {
    checkField(rawSourceText, item.field, item.field.value);
  }
  for (const item of result.documents) {
    checkField(rawSourceText, item);
  }
  for (const item of result.eligibility) {
    checkField(rawSourceText, item);
  }
  for (const item of result.people) {
    checkField(rawSourceText, item);
  }
  for (const item of result.tests) {
    checkField(rawSourceText, item);
  }
  for (const item of result.money) {
    checkField(rawSourceText, item);
  }
  for (const item of result.unusual_rules) {
    checkField(rawSourceText, item);
  }

  return result;
}
