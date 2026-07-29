import { parseAmazonQuantityLines } from './amazon-lines';
import { guessCategorySlug } from './guess-category';
import { parseShopifyQuantityLines } from './shopify-lines';
import type { CategoryOption, ExtractedOrder } from './schema';

/** Dollars like $1,234.56 → cents. */
export function parseMoneyToCents(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Pull a human merchant / restaurant label from common confirmation subjects. */
export function merchantNameFromSubject(subject: string): string | null {
  const patterns = [
    /your order from\s+(.+?)\s*\(/i,
    /your order from\s+(.+)$/i,
    /order confirmation for\s+\S+\s+from\s+(.+)$/i,
    /^(.+?)\s*[-–—]\s*order received/i,
    /^(.+?)\s+order\s*#/i,
  ];
  for (const re of patterns) {
    const m = subject.match(re);
    if (!m?.[1]) continue;
    const name = m[1].replace(/\s+/g, ' ').trim();
    if (name.length >= 2 && name.length <= 80) return name;
  }
  return null;
}

/** Display-name in `From: "Store" <addr@x>` when present. */
export function displayNameFromAddress(fromAddress: string | null | undefined): string | null {
  if (!fromAddress) return null;
  const quoted = fromAddress.match(/^"([^"]+)"\s*</);
  if (quoted?.[1]?.trim()) return quoted[1].trim();
  const plain = fromAddress.match(/^([^<@]+?)\s*</);
  if (plain?.[1]?.trim() && !plain[1].includes('@')) return plain[1].trim();
  return null;
}

function extractOrderNumber(blob: string): string | null {
  return (
    blob.match(/\b(?:order\s*#|order\s*number[:\s]*|order\s*id[:\s]*)([A-Z0-9][A-Z0-9-]{3,})\b/i)?.[1] ??
    blob.match(/\(\s*order\s*#\s*([A-Z0-9][A-Z0-9-]{3,})\s*\)/i)?.[1] ??
    blob.match(/\border\s+(\d{3,})\s+confirmed\b/i)?.[1] ??
    blob.match(/\border\s+(\d{3,})\b/i)?.[1] ??
    blob.match(/\b(\d{3}-\d{7}-\d{7})\b/)?.[1] ??
    null
  );
}

/** Store name printed near the top of many Shopify confirmations. */
export function merchantNameFromBody(text: string): string | null {
  const lines = text
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const thankIdx = lines.findIndex((line) => /thank you for your purchase/i.test(line));
  if (thankIdx >= 0) {
    const candidate = lines[thankIdx + 1];
    if (
      candidate &&
      candidate.length >= 2 &&
      candidate.length <= 60 &&
      !/^order\b/i.test(candidate) &&
      !/^https?:/i.test(candidate) &&
      !/-{3,}/.test(candidate)
    ) {
      return candidate;
    }
  }
  return null;
}

function fallbackLineName(input: {
  subject: string;
  merchantName?: string | null;
}): string {
  const orderedMulti = input.subject.match(
    /^ordered:\s*[“"'](.+?)[”"'](?:\s+and\s+\d+\s+more\s+items?)?\s*$/i,
  )?.[1]?.trim();
  if (orderedMulti) return orderedMulti.replace(/\.\.\.$/, '').slice(0, 200);
  const orderedTitle = input.subject.match(/^ordered:\s*[“"']?(.+?)[”"']?\s*$/i)?.[1]?.trim();
  if (orderedTitle) return orderedTitle.replace(/\.\.\.$/, '').slice(0, 200);
  const fromSubject = merchantNameFromSubject(input.subject);
  if (fromSubject) return fromSubject;
  const ofMatch = input.subject.match(/order of\s+(.+)$/i)?.[1]?.trim();
  if (ofMatch) return ofMatch.slice(0, 200);
  if (input.merchantName) return `${input.merchantName} order`;
  return 'Ordered item';
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
  fromAddress?: string | null;
  receivedAt?: Date | null;
  customCategories?: readonly CategoryOption[];
}): ExtractedOrder | null {
  const blob = `${input.subject}\n${input.text}`;
  const orderNumber = extractOrderNumber(blob);

  const totalMatch =
    blob.match(
      /\b(?:Order\s*Total|Grand\s*Total|Total\s*Charged|Amount\s*Paid|Total)[:\s]*\$?\s*([0-9,]+\.\d{2})/i,
    ) ??
    blob.match(/\b(?:Order\s*Total|Grand\s*Total|Total\s*Charged|Amount\s*Paid)\s*[:\s]*\n\s*([0-9,]+\.\d{2})\s*USD/i) ??
    blob.match(/\$([0-9,]+\.\d{2})\s*(?:total|charged)/i);
  const totalCents = totalMatch ? parseMoneyToCents(totalMatch[1]) : null;
  if (totalCents == null) return null;

  let taxCents =
    parseMoneyToCents(
      blob.match(/\bTaxes?[:\s]*\$?\s*([0-9,]+\.\d{2})/i)?.[1] ?? '',
    ) ?? 0;
  const shippingCents =
    parseMoneyToCents(
      blob.match(/\b(?:Shipping|Delivery|Delivery\s*Fee)[:\s]*\$?\s*([0-9,]+\.\d{2})/i)?.[1] ??
        '',
    ) ?? 0;
  const discountCents =
    parseMoneyToCents(
      blob.match(/\b(?:Discount|Savings|Promo)[:\s]*\$?\s*-?\$?\s*([0-9,]+\.\d{2})/i)?.[1] ?? '',
    ) ?? 0;

  const lines: Array<{
    name: string;
    quantity: number;
    unitPriceCents: number;
    variant: string | null;
    blockText?: string;
  }> = [];

  for (const amazonLine of parseAmazonQuantityLines(input.text)) {
    lines.push({
      name: amazonLine.name,
      quantity: amazonLine.quantity,
      unitPriceCents: amazonLine.unitPriceCents,
      variant: amazonLine.variant,
      blockText: amazonLine.blockText,
    });
  }

  if (lines.length === 0) {
    for (const shopifyLine of parseShopifyQuantityLines(input.text)) {
      lines.push({
        name: shopifyLine.name,
        quantity: shopifyLine.quantity,
        unitPriceCents: shopifyLine.unitPriceCents,
        variant: shopifyLine.variant,
        blockText: shopifyLine.blockText,
      });
    }
  }

  if (lines.length === 0) {
    const lineRe = /^(?:Qty\s*)?(\d+)\s*[x×]\s+(.+?)\s+\$([0-9,]+\.\d{2})\s*$/gim;
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
  }

  const subjectMerchant = merchantNameFromSubject(input.subject);
  const bodyMerchant = merchantNameFromBody(input.text);
  const fromDisplay = displayNameFromAddress(input.fromAddress);
  const merchantName =
    input.merchantName ??
    subjectMerchant ??
    bodyMerchant ??
    (fromDisplay && !/no-?reply|notification|do.?not.?reply/i.test(fromDisplay)
      ? fromDisplay
      : null);

  if (lines.length === 0) {
    const subtotal = Math.max(0, totalCents - taxCents - shippingCents + discountCents);
    lines.push({
      name: fallbackLineName({ subject: input.subject, merchantName }).slice(0, 200),
      quantity: 1,
      unitPriceCents: subtotal,
      variant: null,
    });
  }

  const lineSubtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0);
  if (taxCents === 0) {
    const impliedTax = totalCents - lineSubtotal - shippingCents + discountCents;
    if (impliedTax > 0 && impliedTax < totalCents) {
      taxCents = impliedTax;
    }
  }

  const linesWithCategory: ExtractedOrder['lines'] = lines.map((line) => ({
    name: line.name,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    variant: line.variant,
    categorySlug:
      guessCategorySlug({
        name: line.name,
        merchantSlug: input.merchantSlug,
        subject: input.subject,
        text: line.blockText ?? line.name,
        customCategories: input.customCategories,
      }) ?? null,
  }));

  const received = input.receivedAt ?? new Date();
  const orderDate = received.toISOString().slice(0, 10);

  return {
    merchantName,
    merchantSlug: input.merchantSlug ?? null,
    externalOrderNumber: orderNumber,
    orderDate,
    currency: 'USD',
    taxCents,
    shippingCents,
    discountCents,
    totalCents,
    lines: linesWithCategory,
    confidence: 0.55,
  };
}
