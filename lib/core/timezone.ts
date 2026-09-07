/**
 * Timezones, kept to ones the platform can actually format in.
 *
 * In `core` rather than in either workspace: a timezone is a fact about the
 * account, not about a job search, and since `core.account_settings` became the
 * one place it is stored, the module that parses it cannot sensibly live inside
 * one of the things that reads it. It was in `lib/jobs/` first only because the
 * job side is where the bug below surfaced.
 *
 * The settings field is free text, so it accepted "ET" — which is how people
 * write a timezone and is not an IANA zone name. Nothing validated it going in
 * and nothing guarded it coming out, so every page that formatted a date in
 * the user's zone threw `RangeError: Invalid time zone specified` and returned
 * a 500. It surfaced on the review queue first only because that page formats
 * a date for every row.
 *
 * Two defences, because either alone leaves a hole. Writes are normalised, so
 * a bad value cannot be stored again; reads fall back, so the values already
 * stored — and anything a future write path forgets to check — render instead
 * of taking the page down. A wrong hour is a bug; a blank page is an outage.
 */

/**
 * What people type when they mean a zone.
 *
 * Abbreviations are ambiguous by nature (CST is Chicago, Havana and Beijing),
 * so this maps only the ones with an obvious intended meaning for a job search
 * in the English-speaking world, and maps them to a region rather than to a
 * fixed offset so daylight saving still applies.
 *
 * That last part is why this is consulted BEFORE asking whether the value is a
 * real zone. Several of these — `EST`, `MST`, `HST`, `GMT` — genuinely are IANA
 * identifiers, but they are the legacy fixed-offset ones: `EST` is permanently
 * UTC-5 and never observes daylight saving, so validating first would put
 * somebody in New York an hour out from March to November, on interview times,
 * silently. Nobody who types "EST" means that.
 */
const ALIASES: Record<string, string> = {
  et: 'America/New_York',
  est: 'America/New_York',
  edt: 'America/New_York',
  eastern: 'America/New_York',
  ct: 'America/Chicago',
  cst: 'America/Chicago',
  cdt: 'America/Chicago',
  central: 'America/Chicago',
  mt: 'America/Denver',
  mst: 'America/Denver',
  mdt: 'America/Denver',
  mountain: 'America/Denver',
  pt: 'America/Los_Angeles',
  pst: 'America/Los_Angeles',
  pdt: 'America/Los_Angeles',
  pacific: 'America/Los_Angeles',
  gmt: 'Europe/London',
  bst: 'Europe/London',
  uk: 'Europe/London',
  london: 'Europe/London',
  cet: 'Europe/Paris',
  cest: 'Europe/Paris',
  ist: 'Asia/Kolkata',
  aest: 'Australia/Sydney',
  aedt: 'Australia/Sydney',
  utc: 'UTC',
  z: 'UTC',
};

/** Whether the platform can actually format a date in this zone. */
export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * A stored value turned into a usable zone, or null if it is not one.
 *
 * Returns null rather than guessing wildly: "ET" has an obvious meaning and
 * "my desk" does not, and a write path should reject the second rather than
 * silently filing it under UTC.
 */
export function normalizeTimeZone(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  // Aliases first. See the note on ALIASES: some of these are real zones with
  // the wrong behaviour, so deferring to Intl here would defeat the mapping.
  const alias = ALIASES[raw.toLowerCase().replace(/\s+/g, '')];
  if (alias && isValidTimeZone(alias)) return alias;

  if (isValidTimeZone(raw)) {
    // Canonical casing, so "europe/london" and "Europe/London" are one value.
    try {
      return new Intl.DateTimeFormat('en-GB', { timeZone: raw }).resolvedOptions().timeZone ?? raw;
    } catch {
      return raw;
    }
  }

  return null;
}

/**
 * A zone that is always safe to hand to Intl.
 *
 * Used on every read. The fallback is deliberate: showing a time in the wrong
 * zone is a bug worth fixing, and showing nothing at all is a page that will
 * not load.
 */
export function safeTimeZone(value: string | null | undefined): string {
  return normalizeTimeZone(value) ?? 'UTC';
}
