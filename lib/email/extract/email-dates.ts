/**
 * Shared calendar-date parsing for order / lifecycle email extraction.
 * Prefer dates printed in the message body; fall back to Gmail receivedAt
 * (which is wrong for forwarded Yahoo → Gmail mail).
 */

const MONTH_DAY =
  '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?\\s+\\d{1,2}(?:,?\\s+\\d{4})?';

const ORDER_DATE_LABEL_PATTERNS: RegExp[] = [
  new RegExp(`\\border\\s*date[:\\s]+(${MONTH_DAY})\\b`, 'i'),
  new RegExp(`\\bordered\\s+on[:\\s]+(${MONTH_DAY})\\b`, 'i'),
  new RegExp(`\\border\\s+placed\\s+on[:\\s]+(${MONTH_DAY})\\b`, 'i'),
  new RegExp(`\\bplaced\\s+on[:\\s]+(${MONTH_DAY})\\b`, 'i'),
  new RegExp(`\\bpurchase\\s*date[:\\s]+(${MONTH_DAY})\\b`, 'i'),
  /\border\s*date[:\s]+(\d{4}-\d{2}-\d{2})\b/i,
  /\border\s*date[:\s]+(\d{1,2}\/\d{1,2}\/\d{2,4})\b/i,
  /\bordered\s+on[:\s]+(\d{1,2}\/\d{1,2}\/\d{2,4})\b/i,
  // Shopify-style "Date 05/22/2026" near the top of confirmations.
  /\bDate\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\b/i,
  new RegExp(`\\bDate[:\\s]+(${MONTH_DAY})\\b`, 'i'),
];

/** Parse a loose date string into YYYY-MM-DD, or null. */
export function parseLooseCalendarDate(
  raw: string,
  fallbackYear: number,
): string | null {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;

  const iso = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (isValidYmd(y, m, d)) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  const slash = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    let y = Number(slash[3]);
    if (y < 100) y += 2000;
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    // Prefer US MM/DD/YYYY (this product is US-centric). If the first number
    // cannot be a month, treat as DD/MM/YYYY.
    let m = a;
    let d = b;
    if (a > 12 && b <= 12) {
      m = b;
      d = a;
    }
    if (isValidYmd(y, m, d)) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  const monthNamed = cleaned.match(
    /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/i,
  );
  if (monthNamed) {
    const month = monthIndex(monthNamed[1]);
    const day = Number(monthNamed[2]);
    const year = monthNamed[3] ? Number(monthNamed[3]) : fallbackYear;
    if (month != null && isValidYmd(year, month, day)) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return null;
}

const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function monthIndex(raw: string): number | null {
  return MONTH_INDEX[raw.toLowerCase().replace(/\.$/, '')] ?? null;
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  if (y < 1990 || y > 2100) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function receivedYmd(receivedAt: Date | null | undefined): string {
  return (receivedAt ?? new Date()).toISOString().slice(0, 10);
}

/**
 * Prefer an explicit order/purchase date in the email body; otherwise use the
 * mailbox received date (Gmail internalDate).
 */
export function extractOrderDateYmd(
  blob: string,
  receivedAt?: Date | null,
): string {
  const year = (receivedAt ?? new Date()).getUTCFullYear();
  for (const re of ORDER_DATE_LABEL_PATTERNS) {
    const raw = blob.match(re)?.[1];
    if (!raw) continue;
    const ymd = parseLooseCalendarDate(raw, year);
    if (ymd) return ymd;
  }
  return receivedYmd(receivedAt);
}

/**
 * Lifecycle ship/delivery timestamps: body label first, else receivedAt ISO.
 */
export function extractLifecycleEventAt(
  blob: string,
  kind: 'shipped' | 'delivered',
  receivedAt: Date | null,
): string | null {
  const year = (receivedAt ?? new Date()).getUTCFullYear();
  const patterns =
    kind === 'delivered'
      ? [
          new RegExp(`\\bdelivered\\s+(?:on|by)?\\s*[:\\s]*(${MONTH_DAY})\\b`, 'i'),
          new RegExp(`\\bdelivery\\s+date[:\\s]*(${MONTH_DAY})\\b`, 'i'),
          /\bdelivered\s+(?:on|by)?\s*[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})\b/i,
          /\bdelivery\s+date[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})\b/i,
        ]
      : [
          new RegExp(`\\bshipped\\s+(?:on)?\\s*[:\\s]*(${MONTH_DAY})\\b`, 'i'),
          new RegExp(`\\bship\\s+date[:\\s]*(${MONTH_DAY})\\b`, 'i'),
          /\bshipped\s+(?:on)?\s*[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})\b/i,
          /\bship\s+date[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})\b/i,
        ];
  for (const re of patterns) {
    const raw = blob.match(re)?.[1];
    if (!raw) continue;
    const ymd = parseLooseCalendarDate(raw, year);
    if (!ymd) continue;
    // Noon UTC keeps the calendar day stable across timezones for date-only labels.
    return `${ymd}T12:00:00.000Z`;
  }
  return receivedAt?.toISOString() ?? null;
}
