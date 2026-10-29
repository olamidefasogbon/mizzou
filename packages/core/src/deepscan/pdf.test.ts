import { describe, expect, it } from 'vitest';
import { readPdfText } from './pdf.js';

function minimalPdf(lines: string[]): Uint8Array {
  const content = `BT /F1 12 Tf 50 150 Td (${lines.join(') Tj T* (')}) Tj ET`;
  const parts: string[] = [];
  parts.push('%PDF-1.4\n');
  const offsets: number[] = [];
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  objs.forEach((body, i) => {
    offsets.push(parts.join('').length);
    parts.push(`${i + 1} 0 obj\n${body}\nendobj\n`);
  });
  const xrefAt = parts.join('').length;
  parts.push(`xref\n0 6\n0000000000 65535 f \n`);
  for (const off of offsets) parts.push(`${String(off).padStart(10, '0')} 00000 n \n`);
  parts.push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`);
  return new TextEncoder().encode(parts.join(''));
}

describe('readPdfText', () => {
  it('extracts text from a one-page PDF', async () => {
    const data = minimalPdf(['Hello deadline December 1']);
    const result = await readPdfText(data);
    expect(result.readable).toBe(true);
    if (result.readable) {
      expect(result.text).toContain('December 1');
      expect(result.pages).toBe(1);
    }
  });

  it('reports garbage bytes as unreadable', async () => {
    const result = await readPdfText(new TextEncoder().encode('not a pdf at all'));
    expect(result.readable).toBe(false);
  });
});
