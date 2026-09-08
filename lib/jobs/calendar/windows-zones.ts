/**
 * Outlook's timezone names, translated to the ones `Intl` knows.
 *
 * Outlook and Exchange write `TZID="Eastern Standard Time"` — a Windows zone
 * name, not an IANA one — and a large share of recruiting invites come from
 * Outlook. `Intl.DateTimeFormat` throws `RangeError` on those, which sent the
 * ICS parser down its unknown-zone fallback and stamped the wall clock as UTC.
 * A superday at 10:30am Eastern was stored as 10:30 UTC and read back as
 * 6:30am: four hours wrong, in the one place a wrong hour costs an interview.
 *
 * Note the trap in the name itself: "Eastern Standard Time" is Windows' label
 * for the Eastern zone all year round, daylight saving included. It does NOT
 * mean EST/UTC-5 specifically, so it maps to `America/New_York` and the offset
 * for the actual date is worked out from there — mapping it to a fixed -05:00
 * would be wrong for the eight months of the year that are EDT.
 *
 * CLDR's windowsZones.xml is the full list and runs to a few hundred entries.
 * This is the subset that appears in practice, which is the zones people
 * conduct interviews from. Anything not here still parses; it just falls back
 * as it did before.
 */

const WINDOWS_TO_IANA: Readonly<Record<string, string>> = {
  // North America
  'dateline standard time': 'Etc/GMT+12',
  'hawaiian standard time': 'Pacific/Honolulu',
  'aleutian standard time': 'America/Adak',
  'alaskan standard time': 'America/Anchorage',
  'pacific standard time': 'America/Los_Angeles',
  'pacific standard time (mexico)': 'America/Tijuana',
  'us mountain standard time': 'America/Phoenix',
  'mountain standard time': 'America/Denver',
  'mountain standard time (mexico)': 'America/Chihuahua',
  'central standard time': 'America/Chicago',
  'central standard time (mexico)': 'America/Mexico_City',
  'canada central standard time': 'America/Regina',
  'eastern standard time': 'America/New_York',
  'eastern standard time (mexico)': 'America/Cancun',
  'us eastern standard time': 'America/Indiana/Indianapolis',
  'atlantic standard time': 'America/Halifax',
  'newfoundland standard time': 'America/St_Johns',

  // South America
  'sa pacific standard time': 'America/Bogota',
  'sa western standard time': 'America/La_Paz',
  'sa eastern standard time': 'America/Cayenne',
  'argentina standard time': 'America/Buenos_Aires',
  'e south america standard time': 'America/Sao_Paulo',
  'pacific sa standard time': 'America/Santiago',

  // Europe, Middle East, Africa
  'gmt standard time': 'Europe/London',
  'greenwich standard time': 'Atlantic/Reykjavik',
  'w europe standard time': 'Europe/Berlin',
  'central europe standard time': 'Europe/Budapest',
  'romance standard time': 'Europe/Paris',
  'central european standard time': 'Europe/Warsaw',
  'w central africa standard time': 'Africa/Lagos',
  'gtb standard time': 'Europe/Bucharest',
  'fle standard time': 'Europe/Kiev',
  'e europe standard time': 'Europe/Chisinau',
  'south africa standard time': 'Africa/Johannesburg',
  'israel standard time': 'Asia/Jerusalem',
  'egypt standard time': 'Africa/Cairo',
  'turkey standard time': 'Europe/Istanbul',
  'russian standard time': 'Europe/Moscow',
  'arabic standard time': 'Asia/Baghdad',
  'arab standard time': 'Asia/Riyadh',
  'arabian standard time': 'Asia/Dubai',
  'e africa standard time': 'Africa/Nairobi',
  'iran standard time': 'Asia/Tehran',
  'pakistan standard time': 'Asia/Karachi',

  // Asia and Oceania
  'india standard time': 'Asia/Kolkata',
  'sri lanka standard time': 'Asia/Colombo',
  'bangladesh standard time': 'Asia/Dhaka',
  'se asia standard time': 'Asia/Bangkok',
  'china standard time': 'Asia/Shanghai',
  'singapore standard time': 'Asia/Singapore',
  'w australia standard time': 'Australia/Perth',
  'taipei standard time': 'Asia/Taipei',
  'tokyo standard time': 'Asia/Tokyo',
  'korea standard time': 'Asia/Seoul',
  'cen. australia standard time': 'Australia/Adelaide',
  'aus central standard time': 'Australia/Darwin',
  'e. australia standard time': 'Australia/Brisbane',
  'aus eastern standard time': 'Australia/Sydney',
  'tasmania standard time': 'Australia/Hobart',
  'new zealand standard time': 'Pacific/Auckland',

  // Not a place, but Outlook writes it, and it is unambiguous.
  utc: 'UTC',
};

/**
 * A TZID as something `Intl` will accept, or null when nothing can be made
 * of it.
 *
 * An IANA name is returned unchanged — `Region/City` is already what every
 * other calendar sends, and the map is only consulted for the Windows spelling.
 * Verified against the platform rather than assumed: a name in the table that
 * this runtime's zone database does not carry is no more usable than one that
 * was never in it, and the caller needs to know that now rather than through a
 * `RangeError` later.
 */
export function toIanaZone(tzid: string | null | undefined): string | null {
  if (!tzid) return null;

  // Outlook quotes the value; the parser keeps the quotes off, but a stray
  // pair costs nothing to tolerate.
  const cleaned = tzid.trim().replace(/^"(.*)"$/, '$1').trim();
  if (!cleaned) return null;

  const candidate = WINDOWS_TO_IANA[cleaned.toLowerCase()] ?? cleaned;
  return isKnownZone(candidate) ? candidate : null;
}

/** Whether this runtime's zone database carries the name. */
export function isKnownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
