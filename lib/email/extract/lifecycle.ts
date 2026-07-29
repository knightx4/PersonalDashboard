import type { MessageClassification } from './schema';
import type { ShipmentStatus } from '@/lib/status';
import { extractOrderNumber, parseMoneyToCents } from './heuristic';

export type LifecycleExtraction = {
  externalOrderNumber: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  carrier: string | null;
  shipmentStatus: ShipmentStatus;
  /** ISO timestamptz when known. */
  shippedAt: string | null;
  deliveredAt: string | null;
  refundAmountCents: number | null;
  /** Product name snippets from return/refund mail. */
  itemNameHints: string[];
  confidence: number;
};

const TRACKING_PATTERNS: RegExp[] = [
  /\btracking\s*(?:number|#|no\.?)?[:\s]+([A-Z0-9]{10,})\b/i,
  /\b(?:UPS|FedEx|USPS)\s*(?:tracking)?[:\s#]*([A-Z0-9]{10,})\b/i,
  /\b(1Z[A-Z0-9]{16})\b/i,
  /\b(TBA\d{10,})\b/i,
];

const CARRIER_PATTERNS: Array<{ re: RegExp; name: string }> = [
  { re: /\bUPS\b/i, name: 'UPS' },
  { re: /\bFedEx\b/i, name: 'FedEx' },
  { re: /\bUSPS\b|\bUnited States Postal Service\b/i, name: 'USPS' },
  { re: /\bDHL\b/i, name: 'DHL' },
  { re: /\bAmazon\s*Logistics\b|\bAMZL\b/i, name: 'Amazon Logistics' },
];

function extractTrackingNumber(blob: string): string | null {
  for (const re of TRACKING_PATTERNS) {
    const match = blob.match(re)?.[1]?.trim();
    if (!match) continue;
    // Avoid mistaking Amazon order ids (123-4567890-1234567) for tracking.
    if (/^\d{3}-\d{7}-\d{7}$/.test(match)) continue;
    if (/^\d{3,5}$/.test(match)) continue;
    return match;
  }
  return null;
}

function extractTrackingUrl(blob: string): string | null {
  const match = blob.match(
    /https?:\/\/[^\s"'<>]*(?:track|tracking|shipment|parcel)[^\s"'<>]*/i,
  );
  return match?.[0]?.replace(/[.,);]+$/, '') ?? null;
}

function extractCarrier(blob: string): string | null {
  for (const { re, name } of CARRIER_PATTERNS) {
    if (re.test(blob)) return name;
  }
  return null;
}

function parseLooseDate(raw: string, fallbackYear: number): string | null {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  const asIso = Date.parse(cleaned);
  if (!Number.isNaN(asIso)) return new Date(asIso).toISOString();

  const mdY = cleaned.match(
    /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?)\b/i,
  );
  if (mdY?.[1]) {
    const hasYear = /\d{4}/.test(mdY[1]);
    const candidate = hasYear ? mdY[1] : `${mdY[1]}, ${fallbackYear}`;
    const t = Date.parse(candidate);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return null;
}

function extractEventAt(
  blob: string,
  kind: 'shipped' | 'delivered',
  receivedAt: Date | null,
): string | null {
  const year = (receivedAt ?? new Date()).getUTCFullYear();
  const patterns =
    kind === 'delivered'
      ? [
          /\bdelivered\s+(?:on|by)?\s*[:\s]*([A-Za-z]{3,9}\.? \d{1,2}(?:,? \d{4})?)/i,
          /\bdelivery\s+date[:\s]*([A-Za-z]{3,9}\.? \d{1,2}(?:,? \d{4})?)/i,
        ]
      : [
          /\bshipped\s+(?:on)?\s*[:\s]*([A-Za-z]{3,9}\.? \d{1,2}(?:,? \d{4})?)/i,
          /\bship\s+date[:\s]*([A-Za-z]{3,9}\.? \d{1,2}(?:,? \d{4})?)/i,
        ];
  for (const re of patterns) {
    const raw = blob.match(re)?.[1];
    if (!raw) continue;
    const iso = parseLooseDate(raw, year);
    if (iso) return iso;
  }
  return receivedAt?.toISOString() ?? null;
}

function extractRefundCents(blob: string): number | null {
  const match =
    blob.match(/\brefund(?:ed|ing)?(?:\s+(?:of|for|amount|total))?\s*[:\s]*\$?\s*([0-9,]+\.\d{2})/i) ??
    blob.match(/\$\s*([0-9,]+\.\d{2})\s+(?:has been\s+)?refunded/i) ??
    blob.match(/\bcredited\s+(?:back\s+)?\$?\s*([0-9,]+\.\d{2})/i);
  if (!match?.[1]) return null;
  return parseMoneyToCents(match[1]);
}

function extractItemHints(subject: string, text: string): string[] {
  const hints: string[] = [];
  const returnOf = subject.match(/\breturn of\s+[“"']?(.+?)[”"']?(?:\s+is|\s*$)/i)?.[1];
  if (returnOf) hints.push(returnOf.trim().slice(0, 120));
  const refundFor = subject.match(/\brefund for\s+[“"']?(.+?)[”"']?\s*$/i)?.[1];
  if (refundFor) hints.push(refundFor.trim().slice(0, 120));
  for (const line of text.split(/\n/).slice(0, 40)) {
    const item = line.match(/^\s*(?:item|product)\s*[:\-]\s*(.+)$/i)?.[1]?.trim();
    if (item && item.length >= 3 && item.length <= 120) hints.push(item);
  }
  return [...new Set(hints)];
}

function shipmentStatusFor(
  classification: MessageClassification,
  blob: string,
): ShipmentStatus {
  if (classification === 'delivery' || /\bdelivered\b/i.test(blob)) return 'delivered';
  if (/\bout for delivery\b/i.test(blob)) return 'out_for_delivery';
  if (
    classification === 'shipping' ||
    /\b(?:shipped|on the way|in transit)\b/i.test(blob)
  ) {
    return 'in_transit';
  }
  return 'in_transit';
}

/**
 * Deterministic extraction for shipping / delivery / return / cancellation mail.
 * No LLM — tracking ids and order numbers are regular enough for v1.
 */
export function extractLifecycleFromEmail(input: {
  classification: MessageClassification;
  subject: string;
  text: string;
  html?: string | null;
  receivedAt?: Date | null;
}): LifecycleExtraction | null {
  if (
    input.classification !== 'shipping' &&
    input.classification !== 'delivery' &&
    input.classification !== 'return' &&
    input.classification !== 'cancellation'
  ) {
    return null;
  }

  const blob = `${input.subject}\n${input.text}\n${input.html ?? ''}`;
  const orderNumber = extractOrderNumber(blob);
  const trackingNumber = extractTrackingNumber(blob);
  const trackingUrl = extractTrackingUrl(blob);
  const carrier = extractCarrier(blob);
  const status = shipmentStatusFor(input.classification, blob);
  const shippedAt =
    input.classification === 'shipping' || input.classification === 'delivery'
      ? extractEventAt(blob, 'shipped', input.receivedAt ?? null)
      : null;
  const deliveredAt =
    status === 'delivered'
      ? extractEventAt(blob, 'delivered', input.receivedAt ?? null)
      : null;
  const refundAmountCents =
    input.classification === 'return' ? extractRefundCents(blob) : null;
  const itemNameHints =
    input.classification === 'return'
      ? extractItemHints(input.subject, input.text)
      : [];

  const hasSignal =
    Boolean(orderNumber) ||
    Boolean(trackingNumber) ||
    input.classification === 'cancellation' ||
    input.classification === 'delivery' ||
    input.classification === 'shipping' ||
    input.classification === 'return';

  if (!hasSignal) return null;

  return {
    externalOrderNumber: orderNumber,
    trackingNumber,
    trackingUrl,
    carrier,
    shipmentStatus: status,
    shippedAt,
    deliveredAt,
    refundAmountCents,
    itemNameHints,
    confidence: orderNumber || trackingNumber ? 0.7 : 0.45,
  };
}
