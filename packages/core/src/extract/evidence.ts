import { Extraction } from '../schemas/extraction.js';

function verifyStringQuote(rawText: string, quote: string | null): boolean {
  if (!quote) return false;
  const normalizedSource = rawText.replace(/\s+/g, ' ').toLowerCase();
  const normalizedQuote = quote.replace(/\s+/g, ' ').toLowerCase();
  return normalizedSource.includes(normalizedQuote);
}

export function verifyExtractionEvidence(rawSourceText: string, extraction: Extraction): Extraction {
  const result = JSON.parse(JSON.stringify(extraction)) as Extraction;

  if (result.program.name.evidence_quote) {
    const valid = verifyStringQuote(rawSourceText, result.program.name.evidence_quote);
    result.program.name.checked = valid;
    if (!valid) result.program.name.confidence = 'low';
  }

  if (result.opens && result.opens.evidence_quote) {
    const valid = verifyStringQuote(rawSourceText, result.opens.evidence_quote);
    result.opens.checked = valid;
    if (!valid) result.opens.confidence = 'low';
  }

  result.deadlines.forEach((item) => {
    if (item.field.evidence_quote) {
      const valid = verifyStringQuote(rawSourceText, item.field.evidence_quote);
      item.field.checked = valid;
      if (!valid) item.field.confidence = 'low';
    }
  });

  result.documents.forEach((item) => {
    if (item.evidence_quote) {
      const valid = verifyStringQuote(rawSourceText, item.evidence_quote);
      item.checked = valid;
      if (!valid) item.confidence = 'low';
    }
  });

  result.eligibility.forEach((item) => {
    if (item.evidence_quote) {
      const valid = verifyStringQuote(rawSourceText, item.evidence_quote);
      item.checked = valid;
      if (!valid) item.confidence = 'low';
    }
  });

  return result;
}