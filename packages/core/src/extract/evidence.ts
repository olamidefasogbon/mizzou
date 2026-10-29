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

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/**
 * Light value-support check: when an evidenced date carries an ISO value,
 * the quote must mention its year. A year-less quote still passes when the
 * nearest full date in the page text just before the quote — the multi-part
 * heading case (a "January 2, 2027" heading governing an item line that
 * names no year) — equals the value; anything else stays failed for the
 * judge reconcile step. Full date equality is verified there; this keeps
 * code honest about what it proves.
 */
function quoteSupportsDate(quote: string, value: DateValue, rawText: string): boolean {
  if (value.iso_utc === null || value.iso_utc === undefined) return true;
  const year = value.iso_utc.slice(0, 4);
  if (!/^\d{4}$/.test(year)) return true;
  const q = normalize(quote);
  if (q.includes(year)) return true;
  return nearestHeadingDate(q, rawText, value);
}

/**
 * Multi-part heading case (the Jan-2 fee-waiver example): the quote is an item
 * line naming no date ("Deadline for fee waiver requests") under a heading
 * that carries the full date ("January 2, 2027"). Pass when the nearest
 * month/day/year triple in the page text just before the quote equals the
 * value. A quote from a different section fails because its nearest heading
 * is a different date. Residual looseness: any verbatim line under the
 * right heading passes — the label-to-quote tie stays the reader's job,
 * and full date equality stays the judge reconcile step's.
 */
function nearestHeadingDate(quote: string, rawText: string, value: DateValue): boolean {
  const dt = new Date(value.iso_utc as string);
  if (Number.isNaN(dt.getTime())) return false;
  const page = normalize(rawText);
  const at = page.indexOf(quote);
  if (at < 0) return false;
  const tokens = page.slice(Math.max(0, at - 250), at).split(/[^a-z0-9]+/);
  const isDay = (t: string | undefined): t is string =>
    t !== undefined && /^\d{1,2}$/.test(t) && Number(t) >= 1 && Number(t) <= 31;
  const isYear = (t: string | undefined): t is string => t !== undefined && /^\d{4}$/.test(t);
  const monthAt = (t: string): number => {
    const full = MONTH_NAMES.indexOf(t);
    if (full >= 0) return full;
    return MONTH_NAMES.findIndex((name) => name.slice(0, 3) === t);
  };
  let found: { m: number; d: number; y: number } | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const month = monthAt(tokens[i]);
    if (month < 0) continue;
    // Day and year must sit next to the month ("January 2, 2027" or
    // "15 January 2027") — never a stray number from a nearby section.
    const dayTok = [tokens[i + 1], tokens[i - 1]].find(isDay);
    const yearTok = [tokens[i + 1], tokens[i + 2], tokens[i + 3], tokens[i - 1], tokens[i - 2]].find(isYear);
    if (dayTok !== undefined && yearTok !== undefined) {
      found = { m: month, d: Number(dayTok), y: Number(yearTok) };
    }
  }
  if (!found) return false;
  return found.m === dt.getUTCMonth() && found.d === dt.getUTCDate() && found.y === dt.getUTCFullYear();
}

function checkField(
  rawText: string,
  field: EvidencedField,
  value?: DateValue,
): void {
  const quoteOk = verifyStringQuote(rawText, field.evidence_quote);
  const valueOk = value === undefined || field.evidence_quote === null
    ? true
    : quoteSupportsDate(field.evidence_quote ?? '', value, rawText);
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
