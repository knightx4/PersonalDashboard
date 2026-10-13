import { resumeFileProblem } from '@/lib/jobs/resume-file';
import { MAX_READING_TEXT } from './reading-text';

/**
 * A PDF given as a reading's text (plan #1876.2).
 *
 * The browser puts the file in the person's own folder of the job-search
 * bucket, since a server action takes one megabyte and a PDF may be ten. The
 * server reads it, keeps the text and deletes the file, so only the text
 * survives. The size and type check is the resume upload's.
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** A fresh path for a reading's PDF, under the person's folder. */
export function readingPdfPath(userId: string, fileId: string): string {
  return `${userId}/reading-pdfs/${fileId}.pdf`;
}

/** Whether a path came from readingPdfPath for this person. */
export function ownsReadingPdfPath(userId: string, path: string): boolean {
  const prefix = `${userId}/reading-pdfs/`;
  if (!path.startsWith(prefix)) return false;
  return new RegExp(`^${UUID}\\.pdf$`, 'i').test(path.slice(prefix.length));
}

/** Why a picked file cannot be used, or null: the resume upload's check. */
export function readingPdfProblem(file: { name: string; type: string; size: number }): string | null {
  return resumeFileProblem(file);
}

export const SCAN_MESSAGE =
  'That PDF has no text in it, so it is probably a scan. Dash cannot read scans; paste the text instead.';

export type PdfText =
  | { ok: true; text: string; cut: boolean }
  | { ok: false; error: string };

/**
 * The extracted text made plain. Nothing in it means a scan. Over the cap it
 * is cut there rather than refused, and says so, as a link's text is.
 */
export function cleanPdfText(raw: string): PdfText {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\0/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text === '') return { ok: false, error: SCAN_MESSAGE };
  if (text.length > MAX_READING_TEXT) {
    return { ok: true, text: text.slice(0, MAX_READING_TEXT).trimEnd(), cut: true };
  }
  return { ok: true, text, cut: false };
}

/** The text layer of a PDF's bytes, page by page. */
export async function extractPdfText(bytes: Uint8Array): Promise<PdfText> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return cleanPdfText(Array.isArray(text) ? text.join('\n\n') : text);
  } catch {
    return { ok: false, error: 'Dash could not read that file as a PDF. Try another, or paste the text.' };
  }
}
