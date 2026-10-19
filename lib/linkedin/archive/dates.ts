// The dates in a LinkedIn export come in several shapes, one or two per file.
// Every parser here is pure and returns the same string for the same input on
// every run, so a record's dates can be compared across imports.
//
// Two kinds of result:
//   - an instant, as an ISO string in UTC ("2026-08-21T15:14:57.000Z"), for
//     timestamps. LinkedIn writes the US-style ones ("6/13/26, 11:26 PM")
//     without a zone; they are read as UTC, the zone the other formats name.
//   - a partial date, for the profile's month-or-year dates: "2025-07" for
//     "Jul 2025", "2016" for "2016", and "2026-08-21" for a day such as
//     Connections' "21 Aug 2026".

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function month(name: string): number | null {
  return MONTHS[name.slice(0, 3).toLowerCase()] ?? null;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function iso(y: number, mo: number, d: number, h: number, mi: number, s: number): string | null {
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  const date = new Date(ms);
  // Date.UTC rolls 31 Feb into March; a date that rolled over was not a date.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
    return null;
  }
  if (h > 23 || mi > 59 || s > 59) return null;
  return date.toISOString();
}

/** "6/13/26, 11:26 PM" (Job Applications, Saved Jobs, Invitations), or "12/24/25 06:19 AM UTC" (Receipts). */
const US_SHORT = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)(?:\s+UTC)?$/i;
/** "Fri Aug 21 19:02:55 UTC 2026" (Company Follows). */
const JAVA_DATE = /^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s+UTC\s+(\d{4})$/;
/** "2026-08-21 15:14:57 UTC" (messages, Learning); seconds optional. */
const SQL_UTC = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(?:UTC|Z|\+00:?00)?$/i;

/**
 * Parses a LinkedIn timestamp to an ISO instant in UTC. Returns null for an
 * empty cell or one in no format LinkedIn uses; it never guesses.
 */
export function parseInstant(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;

  let m = US_SHORT.exec(text);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    let hour = Number(m[4]);
    if (hour < 1 || hour > 12) return null;
    const pm = m[7].toUpperCase() === 'PM';
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
    return iso(year, Number(m[1]), Number(m[2]), hour, Number(m[5]), Number(m[6] ?? 0));
  }

  m = JAVA_DATE.exec(text);
  if (m) {
    const mo = month(m[1]);
    if (!mo) return null;
    return iso(Number(m[6]), mo, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
  }

  m = SQL_UTC.exec(text);
  if (m) {
    return iso(
      Number(m[1]), Number(m[2]), Number(m[3]),
      Number(m[4]), Number(m[5]), Number(m[6] ?? 0),
    );
  }

  return null;
}

/** "Jul 2025" or "July 2025". */
const MONTH_YEAR = /^([A-Za-z]{3,9})\.?\s+(\d{4})$/;
/** "2016". */
const YEAR = /^(\d{4})$/;
/** "21 Aug 2026" (Connections' Connected On). */
const DAY_MONTH_YEAR = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/;
/** "2025-07" or "2025-07-14", already in the output shape. */
const ISO_PARTIAL = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;

/**
 * Parses a profile date to "YYYY-MM", "YYYY" or "YYYY-MM-DD", keeping exactly
 * the precision the export gave. Returns null for an empty or unreadable cell.
 */
export function parsePartialDate(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;

  let m = MONTH_YEAR.exec(text);
  if (m) {
    const mo = month(m[1]);
    return mo ? `${m[2]}-${pad(mo)}` : null;
  }

  m = YEAR.exec(text);
  if (m) return m[1];

  m = DAY_MONTH_YEAR.exec(text);
  if (m) {
    const mo = month(m[2]);
    if (!mo) return null;
    const at = iso(Number(m[3]), mo, Number(m[1]), 0, 0, 0);
    return at ? at.slice(0, 10) : null;
  }

  m = ISO_PARTIAL.exec(text);
  if (m) {
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12) return null;
    if (!m[3]) return `${m[1]}-${m[2]}`;
    const at = iso(Number(m[1]), mo, Number(m[3]), 0, 0, 0);
    return at ? at.slice(0, 10) : null;
  }

  return null;
}
