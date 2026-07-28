import type { MessageClassification } from './schema';

export interface MerchantDomainHit {
  id: string;
  slug: string;
  name: string;
  domains: string[];
}

export interface ClassifyInput {
  fromAddress: string | null;
  subject: string | null;
  merchants: readonly MerchantDomainHit[];
}

export interface ClassifyResult {
  classification: MessageClassification;
  merchant: MerchantDomainHit | null;
  /** Tier A = domain match; subject_heuristic = keyword guess without merchant. */
  tier: 'A' | 'subject_heuristic' | 'none';
}

function domainFromAddress(from: string | null): string | null {
  if (!from) return null;
  const match = from.toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/);
  return match?.[1] ?? null;
}

function findMerchant(
  domain: string | null,
  merchants: readonly MerchantDomainHit[],
): MerchantDomainHit | null {
  if (!domain) return null;
  for (const merchant of merchants) {
    for (const d of merchant.domains) {
      const needle = d.toLowerCase();
      if (domain === needle || domain.endsWith(`.${needle}`)) return merchant;
    }
  }
  return null;
}

const ORDER_SUBJECT =
  /\b(order\s*confirmation|thanks for (your )?order|your (?:[\w.'-]+\s+){0,3}order\s+(?:of|has been|is confirmed)|ordered:|order\s*#|order\s*number|order received|we[’']?ve received your order)\b/i;

const SHIPPING_SUBJECT = /\b(shipped|on the way|out for delivery|tracking)\b/i;
const DELIVERY_SUBJECT = /\b(delivered|delivery confirmation)\b/i;
const RETURN_SUBJECT = /\b(return|refund|credited back)\b/i;
const CANCEL_SUBJECT = /\b(cancel(led|lation)?|order canceled)\b/i;

/**
 * Tier A classifier: known merchant domains first, then subject heuristics.
 * Unknown personal mail becomes not_relevant without an LLM call.
 */
export function classifyMessage(input: ClassifyInput): ClassifyResult {
  const domain = domainFromAddress(input.fromAddress);
  const merchant = findMerchant(domain, input.merchants);
  const subject = input.subject ?? '';

  if (CANCEL_SUBJECT.test(subject)) {
    return { classification: 'cancellation', merchant, tier: merchant ? 'A' : 'subject_heuristic' };
  }
  if (RETURN_SUBJECT.test(subject)) {
    return { classification: 'return', merchant, tier: merchant ? 'A' : 'subject_heuristic' };
  }
  if (DELIVERY_SUBJECT.test(subject)) {
    return { classification: 'delivery', merchant, tier: merchant ? 'A' : 'subject_heuristic' };
  }
  if (SHIPPING_SUBJECT.test(subject) && !ORDER_SUBJECT.test(subject)) {
    return { classification: 'shipping', merchant, tier: merchant ? 'A' : 'subject_heuristic' };
  }
  if (ORDER_SUBJECT.test(subject) || (merchant && /\border\b/i.test(subject))) {
    return {
      classification: 'order_confirmation',
      merchant,
      tier: merchant ? 'A' : 'subject_heuristic',
    };
  }

  if (!merchant) {
    return { classification: 'not_relevant', merchant: null, tier: 'none' };
  }

  // Known merchant but no order-like subject — still not an order confirmation.
  return { classification: 'not_relevant', merchant, tier: 'A' };
}
