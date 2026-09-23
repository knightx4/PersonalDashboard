import type { ApplyExtractionResult } from '@/lib/email/extract/apply';
import { domainFromAddress, type MerchantDomainHit } from '@/lib/email/extract/classify';
import { displayNameFromAddress, extractOrderNumber } from '@/lib/email/extract/heuristic';
import { extractedLineSchema, type ExtractedOrder } from '@/lib/email/extract/schema';
import { isPlatformMerchantSlug, isPlatformSenderDomain } from '@/lib/merchants/platform';
import { todayInTimezone } from '@/lib/money';

/** One line of an order draft, in the terms the order form's line rows take. */
export type OrderDraftLine = {
  name: string;
  variant: string | null;
  quantity: number;
  unitPriceCents: number;
  /** A top-level category id, as the form's category select holds. */
  categoryId: string | null;
};

/**
 * An order read out of an email and not saved: the fields of the order form
 * at app/shopping/orders/new, filled from the email.
 *
 * Merchant and date are always there. The merchant is a known merchant's id
 * when the sender's domain matches one, and otherwise a name for the form's
 * "Other (type a name)" field. Everything else is whatever the email gave up.
 */
export type OrderDraft = {
  merchantId: string | null;
  merchantName: string;
  /** YYYY-MM-DD. */
  orderDate: string;
  externalOrderNumber: string | null;
  currency: string;
  lines: OrderDraftLine[];
  taxCents: number;
  shippingCents: number;
  discountCents: number;
  /** The total the email states, when the extractor found one. */
  totalCents: number | null;
  /**
   * False when the lines and charges do not add up to the stated total, or the
   * extractor gave up before checking. Lines kept from a failed read are still
   * the email's own lines, just unchecked.
   */
  reconciled: boolean;
  /** Which reader produced the items: the model, the pattern parser, or neither. */
  source: 'llm' | 'heuristic' | 'none';
  /** Why the extractor refused the read, when it did (schema issues or `reconcile`). */
  issues: string[];
};

type Extraction = {
  result: ApplyExtractionResult;
  source: 'llm' | 'heuristic';
  raw?: unknown;
};

export type DraftEmail = {
  subject: string | null;
  text: string;
  fromAddress: string | null;
  /** When the email was sent or received: the date of last resort. */
  date: Date | null;
};

function titleFromDomain(domain: string): string {
  const label = domain.replace(/^(mail|orders?|noreply|email|e)\./, '').split('.')[0] ?? domain;
  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function knownMerchant(
  fromAddress: string | null,
  merchants: readonly MerchantDomainHit[],
): MerchantDomainHit | null {
  const domain = domainFromAddress(fromAddress);
  if (!domain || isPlatformSenderDomain(domain)) return null;
  for (const merchant of merchants) {
    if (isPlatformMerchantSlug(merchant.slug)) continue;
    for (const d of merchant.domains) {
      const needle = d.toLowerCase();
      if (domain === needle || domain.endsWith(`.${needle}`)) return merchant;
    }
  }
  return null;
}

function nonNegativeInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * What a refused read still holds. A read the extractor refuses for not adding
 * up, or for one bad field, often has good lines in it; each line that passes
 * the line schema on its own is kept.
 */
function salvage(raw: unknown): Partial<ExtractedOrder> & { lines: ExtractedOrder['lines'] } {
  if (!raw || typeof raw !== 'object') return { lines: [] };
  const obj = raw as Record<string, unknown>;
  const lines = Array.isArray(obj.lines)
    ? obj.lines.flatMap((line) => {
        const parsed = extractedLineSchema.safeParse(line);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  const orderDate = text(obj.orderDate);
  return {
    lines,
    merchantName: text(obj.merchantName),
    externalOrderNumber: text(obj.externalOrderNumber),
    orderDate: orderDate && /^\d{4}-\d{2}-\d{2}$/.test(orderDate) ? orderDate : undefined,
    currency: text(obj.currency) ?? undefined,
    taxCents: nonNegativeInt(obj.taxCents) ?? undefined,
    shippingCents: nonNegativeInt(obj.shippingCents) ?? undefined,
    discountCents: nonNegativeInt(obj.discountCents) ?? undefined,
    totalCents: nonNegativeInt(obj.totalCents) ?? undefined,
  };
}

/**
 * Turn an extractor's answer and the email it read into a draft for the order
 * form. What the extractor could not find comes from the email: the merchant
 * from the sender, the date from the email's date, the order number from the
 * subject and body by pattern.
 */
export function draftFromExtraction(input: {
  extraction: Extraction | null;
  email: DraftEmail;
  merchants: readonly MerchantDomainHit[];
  categoryIdsBySlug: ReadonlyMap<string, string>;
  timezone: string;
}): OrderDraft {
  const { extraction, email } = input;
  const ok = extraction?.result.ok ? extraction.result : null;
  const read = ok ? ok.order : salvage(extraction?.raw);
  const refused = extraction && !extraction.result.ok ? extraction.result : null;
  const issues = refused
    ? [...(refused.reason === 'reconcile' ? ['reconcile'] : []), ...(refused.issues ?? [])]
    : [];

  const known = knownMerchant(email.fromAddress, input.merchants);
  const domain = domainFromAddress(email.fromAddress);
  const merchantName =
    known?.name ??
    read.merchantName ??
    displayNameFromAddress(email.fromAddress) ??
    (domain && !isPlatformSenderDomain(domain) ? titleFromDomain(domain) : null) ??
    email.fromAddress ??
    'Unknown merchant';

  const orderDate =
    read.orderDate ?? todayInTimezone(input.timezone, email.date ?? new Date());

  const externalOrderNumber =
    read.externalOrderNumber ?? extractOrderNumber(`${email.subject ?? ''}\n${email.text}`);

  const lines = read.lines.map((line) => ({
    name: line.name,
    variant: line.variant ?? null,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    categoryId: line.categorySlug ? (input.categoryIdsBySlug.get(line.categorySlug) ?? null) : null,
  }));

  return {
    merchantId: known?.id ?? null,
    merchantName,
    orderDate,
    externalOrderNumber,
    currency: read.currency ?? 'USD',
    lines,
    taxCents: read.taxCents ?? 0,
    shippingCents: read.shippingCents ?? 0,
    discountCents: read.discountCents ?? 0,
    totalCents: read.totalCents ?? null,
    reconciled: Boolean(ok),
    source: extraction && lines.length > 0 ? extraction.source : 'none',
    issues,
  };
}

export type ReadOutcome =
  | { messageId: string; subject: string | null; ok: true; draft: OrderDraft }
  | { messageId: string; subject: string | null; ok: false; error: string };

export type ReadSummary = {
  total: number;
  /** Drafts with at least one item. The number the feature's fog asks for. */
  withItems: number;
  /** Of those, the ones whose items and charges add up to the stated total. */
  reconciled: number;
  /** Drafts with no items: merchant and date only. */
  withoutItems: number;
  /** Emails that could not be read at all (Gmail refused, not found). */
  failed: number;
  /** How often each reason for a refused read came up, most common first. */
  issues: Array<{ issue: string; count: number }>;
};

export function summarizeReads(outcomes: readonly ReadOutcome[]): ReadSummary {
  const issueCounts = new Map<string, number>();
  let withItems = 0;
  let reconciled = 0;
  let failed = 0;
  for (const outcome of outcomes) {
    if (!outcome.ok) {
      failed += 1;
      continue;
    }
    if (outcome.draft.lines.length > 0) withItems += 1;
    if (outcome.draft.reconciled) reconciled += 1;
    for (const issue of new Set(outcome.draft.issues)) {
      issueCounts.set(issue, (issueCounts.get(issue) ?? 0) + 1);
    }
  }
  return {
    total: outcomes.length,
    withItems,
    reconciled,
    withoutItems: outcomes.length - failed - withItems,
    failed,
    issues: [...issueCounts]
      .map(([issue, count]) => ({ issue, count }))
      .sort((a, b) => b.count - a.count || a.issue.localeCompare(b.issue)),
  };
}
