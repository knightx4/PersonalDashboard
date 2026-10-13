import { describe, expect, it } from 'vitest';
import {
  cleanPdfText,
  extractPdfText,
  ownsReadingPdfPath,
  readingPdfPath,
  readingPdfProblem,
  SCAN_MESSAGE,
} from './reading-pdf';
import { MAX_READING_TEXT } from './reading-text';

const USER = '11111111-2222-3333-4444-555555555555';
const FILE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/** A one-page PDF with a text layer, built by hand. */
function pdfWith(text: string): Uint8Array {
  const stream = text === '' ? '' : `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

describe('reading pdf paths', () => {
  it('owns a path it made and no other', () => {
    expect(ownsReadingPdfPath(USER, readingPdfPath(USER, FILE))).toBe(true);
    expect(ownsReadingPdfPath(USER, `${USER}/resumes/${FILE}.pdf`)).toBe(false);
    expect(ownsReadingPdfPath(USER, readingPdfPath('99999999-2222-3333-4444-555555555555', FILE))).toBe(false);
    expect(ownsReadingPdfPath(USER, `${USER}/reading-pdfs/../${FILE}.pdf`)).toBe(false);
  });
});

describe('readingPdfProblem', () => {
  it('refuses a big, empty or non-PDF file and keeps a PDF', () => {
    expect(readingPdfProblem({ name: 'a.pdf', type: 'application/pdf', size: 11 * 1024 * 1024 })).toMatch(/10 MB/);
    expect(readingPdfProblem({ name: 'a.pdf', type: 'application/pdf', size: 0 })).toMatch(/empty/);
    expect(readingPdfProblem({ name: 'a.txt', type: 'text/plain', size: 5 })).toBe('Pick a PDF.');
    expect(readingPdfProblem({ name: 'a.pdf', type: 'application/pdf', size: 5 })).toBeNull();
  });
});

describe('cleanPdfText', () => {
  it('calls a file with no text a scan', () => {
    expect(cleanPdfText(' \n\n ')).toEqual({ ok: false, error: SCAN_MESSAGE });
  });
  it('cuts at the cap and says so', () => {
    const result = cleanPdfText('a'.repeat(MAX_READING_TEXT + 50));
    expect(result.ok && result.cut && result.text.length).toBe(MAX_READING_TEXT);
  });
  it('keeps short text whole', () => {
    expect(cleanPdfText('one\r\n\r\n\r\n\r\ntwo')).toEqual({ ok: true, text: 'one\n\ntwo', cut: false });
  });
});

describe('extractPdfText', () => {
  it('reads the text layer', async () => {
    const result = await extractPdfText(pdfWith('Hello reading'));
    expect(result).toEqual({ ok: true, text: 'Hello reading', cut: false });
  });
  it('refuses a page with no text as a scan', async () => {
    expect(await extractPdfText(pdfWith(''))).toEqual({ ok: false, error: SCAN_MESSAGE });
  });
  it('refuses bytes that are not a PDF', async () => {
    const result = await extractPdfText(new TextEncoder().encode('not a pdf'));
    expect(result.ok).toBe(false);
  });
});
