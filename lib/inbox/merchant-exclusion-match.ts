import { bareAddress, domainFromAddress } from '@/lib/email/extract/classify';
import type { MessageClassification } from '@/lib/email/extract/schema';

export type MerchantExclusionRow = {
  merchant_id: string | null;
  /** A sender domain, or a full address for one person at a personal mailbox. */
  match_domain: string | null;
};

/** The error an excluded email is skipped with, and how the sync recognises it later. */
export const EXCLUDED_SENDER_ERROR = 'Excluded by user merchant mute';

/** The error an email the person called "Not an order" in Review is skipped with. */
export const DISMISSED_REVIEW_ERROR = 'Dismissed from review queue';

/**
 * Whether a skipped email was skipped by the person, by muting its sender or
 * dismissing it from Review. The sync retries waiting shipping and return
 * mail on every pass, and must never retry these: a dismissed email that the
 * retry put back in Review is the person's "Not an order" undone.
 */
export function isSkippedByPerson(error: string | null | undefined): boolean {
  return error === EXCLUDED_SENDER_ERROR || error === DISMISSED_REVIEW_ERROR;
}

/**
 * The kinds of email an exclusion applies to: order confirmations, and the
 * shipping, delivery, return and cancellation mail that follows an order.
 */
export const EXCLUDABLE_CLASSIFICATIONS: ReadonlySet<MessageClassification> = new Set([
  'order_confirmation',
  'shipping',
  'delivery',
  'return',
  'cancellation',
]);

function domainMatches(domain: string | null, needle: string): boolean {
  if (!domain) return false;
  return domain === needle || domain.endsWith(`.${needle}`);
}

/**
 * Whether a sender is muted, by merchant or by domain.
 *
 * The domain is checked against both the From and the Reply-To address. A shop
 * on a hosted platform sends From the platform's domain and puts its own in
 * Reply-To, and the review queue writes the Reply-To domain for exactly that
 * reason, so a check on From alone would never match those mutes again.
 *
 * A mute holding a full address (one gmail.com sender, say) matches only that
 * address, never the rest of its domain.
 */
export function isExcludedSender(
  exclusions: readonly MerchantExclusionRow[],
  opts: { merchantId: string | null; fromAddress: string | null; replyToAddress?: string | null },
): boolean {
  if (exclusions.length === 0) return false;

  if (opts.merchantId) {
    for (const row of exclusions) {
      if (row.merchant_id === opts.merchantId) return true;
    }
  }

  const domains = [
    domainFromAddress(opts.fromAddress),
    domainFromAddress(opts.replyToAddress ?? null),
  ];
  if (!domains[0] && !domains[1]) return false;
  const addresses = [bareAddress(opts.fromAddress), bareAddress(opts.replyToAddress ?? null)];

  for (const row of exclusions) {
    const needle = row.match_domain?.toLowerCase();
    if (!needle) continue;
    if (needle.includes('@')) {
      if (addresses.includes(needle)) return true;
      continue;
    }
    if (domains.some((domain) => domainMatches(domain, needle))) return true;
  }

  return false;
}

/**
 * Whether the sync should skip this email as muted: it is a kind an exclusion
 * covers and its sender matches one.
 */
export function isExcludedMessage(
  exclusions: readonly MerchantExclusionRow[],
  opts: {
    classification: MessageClassification;
    merchantId: string | null;
    fromAddress: string | null;
    replyToAddress?: string | null;
  },
): boolean {
  if (!EXCLUDABLE_CLASSIFICATIONS.has(opts.classification)) return false;
  return isExcludedSender(exclusions, opts);
}
