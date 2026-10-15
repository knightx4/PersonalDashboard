/**
 * The person's own details (plan #2124.1): you.details, one row each, as the
 * Details tab and Dash's tools read it. Six values, each optional and kept as
 * they wrote it (supabase/migrations-you/0007_details.sql).
 *
 * No server imports, so the client form and the gallery can use it.
 */

export const DETAIL_KEYS = ['phone', 'linkedin_url', 'citizenship', 'race', 'gender', 'sexuality'] as const;

export type DetailKey = (typeof DETAIL_KEYS)[number];

/** The six details; null is one they have not given. */
export type Details = Record<DetailKey, string | null>;

/** What the Details tab calls each one, in the order it lists them. */
export const DETAIL_LABELS: Record<DetailKey, string> = {
  phone: 'Phone',
  linkedin_url: 'LinkedIn',
  citizenship: 'Citizenship',
  race: 'Race',
  gender: 'Gender',
  sexuality: 'Sexuality',
};

/**
 * Where a LinkedIn address, kept as typed, opens. One typed without its
 * scheme ('linkedin.com/in/someone') gets https in front; anything but http
 * or https is treated as having none, so a stored value never becomes a
 * script link.
 */
export function linkedinHref(value: string): string {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^[a-z][a-z0-9+.-]*:\/*/i, '')}`;
}

/** The columns a row is read with. */
export const DETAIL_COLUMNS = DETAIL_KEYS.join(', ');

/** The most characters each detail may hold, matching the table's checks. */
export const DETAIL_MAX: Record<DetailKey, number> = {
  phone: 200,
  linkedin_url: 500,
  citizenship: 200,
  race: 200,
  gender: 200,
  sexuality: 200,
};

export const EMPTY_DETAILS: Details = {
  phone: null,
  linkedin_url: null,
  citizenship: null,
  race: null,
  gender: null,
  sexuality: null,
};

/** A row as stored; any column may be missing from a partial read. */
export type DetailsRow = Partial<Record<DetailKey, string | null>>;

export function detailsFromRow(row: DetailsRow | null | undefined): Details {
  const out = { ...EMPTY_DETAILS };
  for (const key of DETAIL_KEYS) out[key] = cleanDetail(row?.[key]);
  return out;
}

/** Trims a value; blank or not text is null, so an emptied field clears the detail. */
export function cleanDetail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** What is wrong with a set of details, or null when they can be saved. */
export function checkDetails(patch: Partial<Record<DetailKey, string | null>>): string | null {
  for (const key of DETAIL_KEYS) {
    const value = cleanDetail(patch[key]);
    if (value !== null && value.length > DETAIL_MAX[key]) {
      return `${key.replace('_', ' ')} is longer than ${DETAIL_MAX[key]} characters.`;
    }
  }
  return null;
}

/**
 * Why a save of the details did not go through, in words that say whether
 * pressing Save again will help: after a dropped connection it will, after a
 * refused value it will not.
 */
export function whyNotSaved(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch failed|network|timed? ?out|ECONN|ENOTFOUND|socket/i.test(message)) {
    return 'The connection dropped before your details saved. What you typed is still here: press Save to try again.';
  }
  const reason = message.replace(/^Saving your details failed: /, '').replace(/\.$/, '');
  return `The database refused these details (${reason}). What you typed is still here.`;
}
