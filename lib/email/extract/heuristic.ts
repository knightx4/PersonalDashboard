import type { ExtractedOrder } from './schema';

/** Dollars like $1,234.56 → cents. */
export function parseMoneyToCents(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * Deterministic extraction for well-structured confirmation emails.
 * Used in fixtures and as a fallback when ANTHROPIC_API_KEY is unset.
 */
export function heuristicExtractOrder(input: {
  subject: string;
  text: string;
  merchantSlug?: string | null;
  merchantName?: string | null;
  receivedAt?: Date | null;
}): ExtractedOrder | null {
  const blob = `${input.subject}\n${input.text}`;

  const orderNumber =
    blob.match(/\b(?:Order\s*#|Order\s*Number[:\s]*|Order\s*ID[:\s]*)([A-Z0-9][A-Z0-9-]{5,})\b/i)?.[1] ??
    blob.match(/\b(\d{3}-\d{7}-\d{7})\b/)?.[1] ??
    null;

  const totalMatch =
    blob.match(/\b(?:Order\s*Total|Grand\s*Total|Total\s*Charged|Amount\s*Paid|Total)[:\s]*\$?\s*([0-9,]+\.\d{2})/i) ??
    blob.match(/\$([0-9,]+\.\d{2})\s*(?:total|charged)/i);
  const totalCents = totalMatch ? parseMoneyToCents(totalMatch[1]) : null;
  if (totalCents == null) return null;

  const taxCents = parseMoneyToCents(
    blob.match(/\bTax[:\s]*\$?\s*([0-9,]+\.\d{2})/i)?.[1] ?? '',
  ) ?? 0;
  const shippingCents = parseMoneyToCents(
    blob.match(/\b(?:Shipping|Delivery)[:\s]*\$?\s*([0-9,]+\.\d{2})/i)?.[1] ?? '',
  ) ?? 0;
  const discountCents = parseMoneyToCents(
    blob.match(/\b(?:Discount|Savings|Promo)[:\s]*\$?\s*-?\$?\s*([0-9,]+\.\d{2})/i)?.[1] ?? '',
  ) ?? 0;

  const lines: ExtractedOrder['lines'] = [];
  const lineRe =
    /^(?:Qty\s*)?(\d+)\s*[x×]\s+(.+?)\s+\$([0-9,]+\.\d{2})\s*$/gim;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(input.text)) !== null) {
    const unit = parseMoneyToCents(m[3]);
    if (unit == null) continue;
    lines.push({
      name: m[2].trim().slice(0, 200),
      quantity: Number(m[1]),
      unitPriceCents: unit,
      variant: null,
    });
  }

  if (lines.length === 0) {
    const nameFromSubject =
      input.subject.match(/order of\s+(.+)$/i)?.[1]?.trim() ??
      input.subject.match(/:\s*(.+)$/)?.[1]?.trim() ??
      'Ordered item';
    const subtotal = Math.max(0, totalCents - taxCents - shippingCents + discountCents);
    lines.push({
      name: nameFromSubject.slice(0, 200),
      quantity: 1,
      unitPriceCents: subtotal,
      variant: null,
    });
  }

  const received = input.receivedAt ?? new Date();
  const orderDate = received.toISOString().slice(0, 10);

  return {
    merchantName: input.merchantName ?? null,
    merchantSlug: input.merchantSlug ?? null,
    externalOrderNumber: orderNumber,
    orderDate,
    currency: 'USD',
    taxCents,
    shippingCents,
    discountCents,
    totalCents,
    lines,
    confidence: 0.55,
  };
}
