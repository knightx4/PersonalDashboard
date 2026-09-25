import type { MessageClassification } from './schema';
import type { ShipmentStatus } from '@/lib/status';
import { extractLifecycleEventAt } from './email-dates';
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

// Every carrier's tracking number carries digits. Without that requirement a
// heading such as "Tracking Information" reads as tracking number "Information".
const TRACKING_PATTERNS: RegExp[] = [
  /\btracking\s*(?:number|#|no\.?)?[:\s]+((?=[A-Z]*\d)[A-Z0-9]{10,})\b/i,
  /\b(?:UPS|FedEx|USPS)\s*(?:tracking)?[:\s#]*((?=[A-Z]*\d)[A-Z0-9]{10,})\b/i,
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

/**
 * The link a person would press to follow the parcel.
 *
 * Store mail usually routes every link through a click tracker, so the URL
 * itself rarely says "track". The button text does, which is why an anchor
 * reading "Track package" is preferred over a URL that merely looks like one.
 */
function extractTrackingUrl(blob: string): string | null {
  for (const anchor of blob.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = anchor[1]!.replace(/&amp;/g, '&').trim();
    const label = anchor[2]!.replace(/<[^>]+>/g, ' ');
    if (/^https?:\/\//i.test(href) && /\btrack/i.test(label)) return href;
  }
  const match = blob.match(
    /https?:\/\/[^\s"'<>]*(?:track|tracking|shipment|parcel)[^\s"'<>]*/i,
  );
  return match?.[0]?.replace(/&amp;/g, '&').replace(/[.,);]+$/, '') ?? null;
}

/** The carrier's own tracking page, for mail that gives a number but no link. */
export function carrierTrackingUrl(
  carrier: string | null,
  trackingNumber: string | null,
): string | null {
  if (!trackingNumber) return null;
  const n = encodeURIComponent(trackingNumber);
  const which = /^1Z/i.test(trackingNumber) ? 'UPS' : carrier;
  switch (which) {
    case 'UPS':
      return `https://www.ups.com/track?tracknum=${n}`;
    case 'FedEx':
      return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
    case 'USPS':
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`;
    case 'DHL':
      return `https://www.dhl.com/us-en/home/tracking/tracking-express.html?tracking-id=${n}`;
    default:
      return null;
  }
}

function extractCarrier(blob: string): string | null {
  for (const { re, name } of CARRIER_PATTERNS) {
    if (re.test(blob)) return name;
  }
  return null;
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
  const carrier = extractCarrier(blob);
  const trackingUrl =
    extractTrackingUrl(blob) ?? carrierTrackingUrl(carrier, trackingNumber);
  const status = shipmentStatusFor(input.classification, blob);
  const shippedAt =
    input.classification === 'shipping' || input.classification === 'delivery'
      ? extractLifecycleEventAt(blob, 'shipped', input.receivedAt ?? null)
      : null;
  const deliveredAt =
    status === 'delivered'
      ? extractLifecycleEventAt(blob, 'delivered', input.receivedAt ?? null)
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
