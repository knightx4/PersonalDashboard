/**
 * The text you give a reading (plan #1876.1).
 *
 * Kept on the reading as given_text, capped at this many characters. Pasted
 * text and, later, text read out of a PDF both go through cleanReadingText.
 */

import { formatNumber } from '@/lib/money';
export const MAX_READING_TEXT = 200_000;

export const PASTED_LABEL = 'Pasted';

export type CleanedText = { ok: true; text: string } | { ok: false; error: string };

/** Line endings made plain, ends trimmed; refused when empty or over the cap. */
export function cleanReadingText(raw: string): CleanedText {
  const text = raw.replace(/\r\n?/g, '\n').replace(/\0/g, '').trim();
  if (text === '') return { ok: false, error: 'Paste the text of the reading first.' };
  if (text.length > MAX_READING_TEXT) {
    return {
      ok: false,
      error: `That is ${formatNumber(text.length)} characters and a reading keeps at most ${formatNumber(MAX_READING_TEXT)}. Paste the part you want Dash to read.`,
    };
  }
  return { ok: true, text };
}
