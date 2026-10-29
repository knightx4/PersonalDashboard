/**
 * The person's own details (plan #2124.1): you.details, one row each, as the
 * Details tab and Dash's tools read it. Ten values, each optional and kept as
 * they wrote it (supabase/migrations-you/0007_details.sql). The name, email,
 * phone and mailing address are what a cover letter is signed with
 * (supabase/migrations-you/0031_details_name_address.sql), and the website
 * is where a published essay is linked (0032).
 *
 * No server imports, so the client form and the gallery can use it.
 */

export const DETAIL_KEYS = [
  'full_name',
  'email',
  'phone',
  'mailing_address',
  'website_url',
  'linkedin_url',
  'citizenship',
  'race',
  'gender',
  'sexuality',
] as const;

export type DetailKey = (typeof DETAIL_KEYS)[number];

/** One field of their own: a name and a value they chose (plan #2531.1). */
export type CustomField = { id: string; label: string; value: string };

export const CUSTOM_FIELDS_MAX = 30;
export const CUSTOM_LABEL_MAX = 80;
export const CUSTOM_VALUE_MAX = 500;
export const CUSTOM_ID_MAX = 64;

/** The fixed details, null for one they have not given, and the fields of their own. */
export type Details = Record<DetailKey, string | null> & { custom_fields: CustomField[] };

/** The fixed details as the form sends them. */
export type SixDetails = Record<DetailKey, string | null>;

/** What the Details tab calls each one, in the order it lists them. */
export const DETAIL_LABELS: Record<DetailKey, string> = {
  full_name: 'Full name',
  email: 'Email',
  phone: 'Phone',
  mailing_address: 'Mailing address',
  website_url: 'Website',
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

/**
 * What a letter is signed with, from their details: the name under the
 * sign-off, and the contact line at its foot (address, phone and email, in
 * that order, each left out when they have not given it). Null when they have
 * given none of them, so a letter with no details carries no contact line.
 */
export type Letterhead = { signer: string | null; contact: string | null };

export function letterheadFrom(
  details: Pick<Details, 'full_name' | 'email' | 'phone' | 'mailing_address'>,
): Letterhead {
  const contact = [details.mailing_address, details.phone, details.email]
    .map((part) => part?.replace(/\s+/g, ' ').trim() ?? '')
    .filter(Boolean)
    .join('   ');
  return { signer: details.full_name?.trim() || null, contact: contact || null };
}

/**
 * Their website as the essay Publish card names it: the host and path with no
 * scheme ("alexrivera.dev"), or null when they have not given one or what they
 * typed is not an http(s) address.
 */
export function siteName(website: string | null | undefined): string | null {
  const typed = website?.trim();
  if (!typed) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(typed) ? typed : `https://${typed}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return `${url.host}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** The columns a row is read with. */
export const DETAIL_COLUMNS = `${DETAIL_KEYS.join(', ')}, custom_fields`;

/** The most characters each detail may hold, matching the table's checks. */
export const DETAIL_MAX: Record<DetailKey, number> = {
  full_name: 200,
  email: 200,
  phone: 200,
  mailing_address: 500,
  website_url: 500,
  linkedin_url: 500,
  citizenship: 200,
  race: 200,
  gender: 200,
  sexuality: 200,
};

export const EMPTY_DETAILS: Details = {
  custom_fields: [],
  full_name: null,
  email: null,
  phone: null,
  mailing_address: null,
  website_url: null,
  linkedin_url: null,
  citizenship: null,
  race: null,
  gender: null,
  sexuality: null,
};

/** A row as stored; any column may be missing from a partial read. */
export type DetailsRow = Partial<Record<DetailKey, string | null>> & { custom_fields?: unknown };

/** What a save may carry: any of the fixed details, and the whole list of own fields. */
export type DetailsPatch = Partial<Record<DetailKey, string | null>> & { custom_fields?: unknown };

export function detailsFromRow(row: DetailsRow | null | undefined): Details {
  const out: Details = { ...EMPTY_DETAILS, custom_fields: [] };
  for (const key of DETAIL_KEYS) out[key] = cleanDetail(row?.[key]);
  out.custom_fields = readCustomFields(row?.custom_fields);
  return out;
}

/**
 * A stored list read for display: entries that are not {id, label, value}
 * text are skipped rather than thrown on, so one bad entry cannot hide the page.
 */
export function readCustomFields(raw: unknown): CustomField[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { id, label, value } = item as Record<string, unknown>;
    if (typeof id !== 'string' || typeof label !== 'string' || typeof value !== 'string') continue;
    out.push({ id, label: label.trim(), value: value.trim() });
  }
  return out;
}

/** The list with every label and value trimmed; call after checkCustomFields passes. */
export function cleanCustomFields(raw: unknown): CustomField[] {
  return readCustomFields(raw);
}

/** What is wrong with a list of own fields, or null when it can be saved. */
export function checkCustomFields(raw: unknown): string | null {
  if (!Array.isArray(raw)) return 'Your own fields must be a list.';
  if (raw.length > CUSTOM_FIELDS_MAX) return `You can keep at most ${CUSTOM_FIELDS_MAX} fields of your own.`;
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return 'Each of your own fields needs an id, a name and a value.';
    const { id, label, value } = item as Record<string, unknown>;
    if (typeof id !== 'string' || id.length < 1 || id.length > CUSTOM_ID_MAX) return 'Each of your own fields needs an id.';
    if (seen.has(id)) return 'Two of your own fields share an id.';
    seen.add(id);
    if (typeof label !== 'string' || label.trim() === '') return 'Each of your own fields needs a name.';
    if (label.trim().length > CUSTOM_LABEL_MAX) return `A field name can be at most ${CUSTOM_LABEL_MAX} characters.`;
    if (typeof value !== 'string') return 'Each of your own fields needs a value.';
    if (value.trim().length > CUSTOM_VALUE_MAX) return `A field value can be at most ${CUSTOM_VALUE_MAX} characters.`;
  }
  return null;
}

/**
 * What is wrong with each of their own fields as the Details form holds them,
 * by field id, in words to show under that field (plan #2531.2). An empty
 * result means every field can be saved; checkCustomFields still guards the
 * list as a whole.
 */
export function customFieldErrors(fields: CustomField[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const label = field.label.trim();
    if (label === '') errors[field.id] = 'Give this field a name, or remove it.';
    else if (label.length > CUSTOM_LABEL_MAX) errors[field.id] = `A name can be at most ${CUSTOM_LABEL_MAX} characters.`;
    else if (field.value.trim().length > CUSTOM_VALUE_MAX) {
      errors[field.id] = `A value can be at most ${CUSTOM_VALUE_MAX} characters.`;
    }
  }
  return errors;
}

/** Trims a value; blank or not text is null, so an emptied field clears the detail. */
export function cleanDetail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** What is wrong with a set of details, or null when they can be saved. */
export function checkDetails(patch: DetailsPatch): string | null {
  for (const key of DETAIL_KEYS) {
    const value = cleanDetail(patch[key]);
    if (value !== null && value.length > DETAIL_MAX[key]) {
      return `${key.replace('_', ' ')} is longer than ${DETAIL_MAX[key]} characters.`;
    }
  }
  if (patch.custom_fields !== undefined) return checkCustomFields(patch.custom_fields);
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
