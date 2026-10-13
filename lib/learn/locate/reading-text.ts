import 'server-only';

import { fetchDocument } from '@/lib/learn/providers';
import { toPlainText } from '@/lib/learn/locate/html';
import { loadReadingText } from '@/lib/learn/tracks/load';
import { MAX_READING_TEXT } from '@/lib/learn/tracks/reading-text';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * The text of one reading, for Summarize and the chat (plan #1876.3).
 *
 * Text you gave the reading wins and its link is never fetched. Otherwise the
 * page is fetched and reduced to plain text. Either way at most the first
 * MAX_READING_TEXT characters come back, with `truncated` saying so.
 */

/** Fewer characters than this from a link is a stub, a cookie wall or a login page. */
export const MIN_LINK_TEXT = 200;

export const UNREADABLE_MESSAGE = 'Dash could not read this link; paste the text or upload a PDF.';

export type UnreadableReason =
  | 'no-link'
  | 'blocked'
  | 'not-found'
  | 'unsupported-type'
  | 'pdf'
  | 'too-large'
  | 'timeout'
  | 'too-little-text'
  | 'error';

export type ReadingTextResult =
  | {
      ok: true;
      text: string;
      /** 'given' is text you pasted or uploaded; 'link' was fetched from the reading's link. */
      from: 'given' | 'link';
      /** The label you gave it ('Pasted', a file name) or the address it was fetched from. */
      label: string;
      /** True when the reading is longer than what is returned. */
      truncated: boolean;
    }
  | { ok: false; reason: UnreadableReason; message: string };

function capped(text: string): { text: string; truncated: boolean } {
  return text.length > MAX_READING_TEXT
    ? { text: text.slice(0, MAX_READING_TEXT), truncated: true }
    : { text, truncated: false };
}

function unreadable(reason: UnreadableReason): ReadingTextResult {
  return { ok: false, reason, message: UNREADABLE_MESSAGE };
}

/** Text for a reading: what you gave it, else its link. Pass the link as `url`. */
export async function getReadingText(
  supabase: LearnSupabaseClient,
  reading: { id: string; url: string | null },
): Promise<ReadingTextResult> {
  const given = await loadReadingText(supabase, reading.id);
  if (given) {
    return { ok: true, from: 'given', label: given.label, ...capped(given.text) };
  }

  if (!reading.url) return unreadable('no-link');

  const fetched = await fetchDocument(reading.url);
  if (!fetched.ok) return unreadable(fetched.reason);
  if (fetched.contentType === 'pdf') return unreadable('pdf');

  const plain = fetched.contentType === 'html' ? toPlainText(fetched.text) : fetched.text.trim();
  if (plain.length < MIN_LINK_TEXT) return unreadable('too-little-text');

  return { ok: true, from: 'link', label: fetched.url, ...capped(plain) };
}
