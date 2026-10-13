import { MAX_READING_TEXT } from '@/lib/learn/tracks/reading-text';

/**
 * Summarize on a reading (plan #1876.4): the parts with no model in them.
 *
 * The prompt's user turn, the reply made fit to keep, and the line the page
 * shows above a summary saying what it was written from.
 */

/** The longest summary kept; the column's check allows 20,000 characters. */
export const MAX_SUMMARY = 6_000;

/**
 * The last words of the reader's unreadable message (UNREADABLE_MESSAGE in
 * lib/learn/locate/reading-text.ts), which the page makes a link to the paste
 * and upload buttons. A test checks the two agree.
 */
export const UNREADABLE_ACTION = 'paste the text or upload a PDF';

/** The user turn: what the reading is and its text. */
export function describeReading(input: { title: string; why: string | null; text: string }): string {
  const lines = [`Title: ${input.title}`];
  if (input.why?.trim()) lines.push(`Why it is on their reading list: ${input.why.trim()}`);
  lines.push('', '<reading>', input.text, '</reading>');
  return lines.join('\n');
}

/**
 * The reply as it is kept: trimmed, a heading the model added taken off,
 * blank lines collapsed to one. Null when nothing usable is left.
 */
export function usableSummary(reply: string): string | null {
  let text = reply.replace(/\r\n?/g, '\n').trim();
  text = text.replace(/^(#+\s*)?summary\s*:?\s*\n+/i, '').trim();
  text = text.replace(/\n{3,}/g, '\n\n');
  if (text.length < 20) return null;
  return text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY).trimEnd()}…` : text;
}

/** The summary's paragraphs, for the page. */
export function summaryParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * The line above a summary: what it was written from. For a link, the site's
 * name, which the page draws as a link to the address.
 */
export function summarySource(summary: { from: 'given' | 'link'; label: string }): {
  text: string;
  site: string | null;
} {
  if (summary.from === 'link') return { text: 'From the page at', site: siteName(summary.label) };
  if (summary.label === 'Pasted') return { text: 'From the text you pasted.', site: null };
  return { text: `From the text you gave it: ${summary.label}.`, site: null };
}

/** The line saying the reading was cut, or null when Dash read all of it. */
export function summaryCutLine(truncated: boolean): string | null {
  if (!truncated) return null;
  return `The reading is longer than ${MAX_READING_TEXT.toLocaleString('en-GB')} characters, so Dash read only the first ${MAX_READING_TEXT.toLocaleString('en-GB')} and this summary covers that part.`;
}

/** The host of an address without "www.", or the address itself when it is not one. */
export function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return url;
  }
}
