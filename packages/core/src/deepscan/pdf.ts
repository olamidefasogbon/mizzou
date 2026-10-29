// read_pdf: text extraction from PDFs via unpdf (PROMPT.md tool table).
// Scanned PDFs with no text layer report as unreadable with the link.

import { extractText } from 'unpdf';

export type PdfReadResult =
  | { readable: true; text: string; pages: number }
  | { readable: false; reason: string };

/** Extract text; empty or unparseable documents come back unreadable. */
export async function readPdfText(data: Uint8Array): Promise<PdfReadResult> {
  let parsed: { totalPages: number; text: string | string[] };
  try {
    parsed = await extractText(data, { mergePages: true });
  } catch (err) {
    return { readable: false, reason: `could not parse the PDF: ${(err as Error)?.message ?? 'unknown error'}` };
  }
  const text = (typeof parsed.text === 'string' ? parsed.text : parsed.text.join('\n')).trim();
  if (text.length === 0) {
    return { readable: false, reason: 'the PDF has no text layer (scanned image)' };
  }
  return { readable: true, text, pages: parsed.totalPages };
}
