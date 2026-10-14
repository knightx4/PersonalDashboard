/**
 * Reading what was typed into capture aimed at a Shopping kind (plan
 * #1950.3.1): the link in a saved thing, and an ISBN typed as an item. No
 * server in it, so it is tested on its own.
 */

import { normalizeIsbn } from '@/lib/books/isbn';

const LINK = /https?:\/\/[^\s<>"']+/i;

/**
 * The first link in what was typed, and the words around it as a note.
 * A bare domain ("example.com/kettle") is read as https. Null when there is
 * no link at all.
 */
export function linkIn(text: string): { url: string; note: string | null } | null {
  const trimmed = text.trim();
  const found = trimmed.match(LINK);
  let url: string | null = found ? found[0].replace(/[).,;]+$/, '') : null;
  let rest = found ? trimmed.replace(found[0], ' ') : trimmed;
  if (!url) {
    const bare = trimmed.match(/(?:^|\s)((?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?)/i);
    if (!bare) return null;
    url = `https://${bare[1].replace(/[).,;]+$/, '')}`;
    rest = trimmed.replace(bare[1], ' ');
  }
  try {
    url = new URL(url).toString();
  } catch {
    return null;
  }
  const note = rest.replace(/\s+/g, ' ').trim();
  return { url, note: note || null };
}

/** A name for a link the page gave none for: its host and the last part of its path. */
export function linkTitle(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const last = parsed.pathname.split('/').filter(Boolean).pop();
    const words = last ? decodeURIComponent(last).replace(/[-_]+/g, ' ').replace(/\.\w+$/, '').trim() : '';
    return words && !/^\d+$/.test(words) ? `${words} (${host})` : host;
  } catch {
    return url;
  }
}

/**
 * The ISBN-13 when what was typed is an ISBN and nothing else: digits,
 * spaces and hyphens, with a valid check digit. A name with a number in it
 * is a name.
 */
export function typedIsbn(text: string): string | null {
  const trimmed = text.trim();
  if (!/^[\d\s-]{9,17}[\dXx]?$/.test(trimmed)) return null;
  return normalizeIsbn(trimmed)?.isbn13 ?? null;
}
