import { createHash } from 'node:crypto';

// The stable keys a record is matched on from one import to the next. Where
// LinkedIn gives an id (a job, a profile, a conversation) the key is that id;
// where a file has none, it is a hash of the fields that identify the row, so
// editing a description on LinkedIn does not make the row look new.

/** The numeric job id from a LinkedIn job URL, or null when it has none. */
export function jobIdFromUrl(url: string | null | undefined): string | null {
  const text = (url ?? '').trim();
  if (!text) return null;
  const view = /linkedin\.com\/(?:comm\/)?jobs\/view\/(?:[^/?#]*?-)?(\d{5,})/i.exec(text);
  if (view) return view[1];
  const param = /[?&]currentJobId=(\d{5,})/i.exec(text);
  return param ? param[1] : null;
}

/**
 * The profile slug from a LinkedIn profile URL ("https://www.linkedin.com/in/
 * jane-doe-1a2b3c/" gives "jane-doe-1a2b3c"), decoded and lower-cased so the
 * same person has one key in every file.
 */
export function profileSlugFromUrl(url: string | null | undefined): string | null {
  const text = (url ?? '').trim();
  if (!text) return null;
  const m = /linkedin\.com\/in\/([^/?#\s]+)/i.exec(text);
  if (!m) return null;
  let slug = m[1];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // A malformed escape stays as written; it is still the same every run.
  }
  return slug.toLowerCase();
}

/** Trims and collapses whitespace, and lower-cases, for a key built from text. */
export function keyText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * A short hash of the given parts: "h:" and the first 16 hex characters of
 * their SHA-256. Each part is normalised with keyText first.
 */
export function rowHash(...parts: (string | null | undefined)[]): string {
  const body = JSON.stringify(parts.map(keyText));
  return `h:${createHash('sha256').update(body).digest('hex').slice(0, 16)}`;
}
