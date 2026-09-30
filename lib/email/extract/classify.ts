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

/** The bare address in a From or Reply-To header, lowercased. */
function bareAddress(from: string | null): string | null {
  if (!from) return null;
  const match = from.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  return match?.[0] ?? null;
}

export { bareAddress, domainFromAddress };

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

/**
 * Confirmation subjects. "Order confirmed" and "Thank you for your order" are
 * the two the old list missed; James Avery's "Order Confirmed! We'll Take It
 * From Here" was dropped as not_relevant before its body was read.
 */
const ORDER_SUBJECT =
  /(?:\bordered:|\b(?:order\s*confirmation|order\s+(?:\S+\s+)?(?:is\s+|has\s+been\s+)?confirmed|thank(?:s| you) for (?:your )?(?:order|purchase)|purchase confirmation|confirmation of your order|your (?:[\w.'-]+\s+){0,3}order\s+(?:of|has been|is confirmed|from)|order\s*#|order\s*number|order received|we['’]?ve received your order)\b)/i;

const SHIPPING_SUBJECT = /\b(shipped|on the way|out for delivery|tracking)\b/i;
/**
 * Shipping subjects that carry an order number, which ORDER_SUBJECT also
 * matches. Shopify's "A shipment from order #613080 is on the way" was filed as
 * a confirmation, failed extraction for having no totals, and sat in review.
 */
const SHIPMENT_OF_ORDER =
  /\b(shipment from order|has been shipped|has shipped|was shipped|has your order|about to ship|delivery estimate)\b/i;
const DELIVERY_SUBJECT = /\b(delivered|delivery confirmation|has arrived)\b/i;
const RETURN_SUBJECT = /\b(return|refund|credited back)\b/i;
const CANCEL_SUBJECT = /\b(cancel(led|lation)?|order canceled)\b/i;
/** Reviews, promos, and price-drop mail that mention "order" but are not confirmations. */
const NOT_ORDER_SUBJECT =
  /\b(review (it|your)|meet your expectations|pre-order now|saved additional money|off your .{0,40}order|catering order of|rate your|how was your|feedback|survey|unsubscribe)\b/i;

/**
 * Discount and come-back mail from merchants we know. Uber Eats and DoorDash
 * send "Avery save $25—order again today" and "50% off an order with your Chase
 * card"; the sender is a merchant and the subject says "order", which was
 * enough to file them as confirmations and send them to review.
 */
const PROMO_SUBJECT =
  /(?:\d+%\s*off\b|\$\d+\+?\s*off\b|\bsave \$?\d|\border (?:again|in|up)\b|\bplace (?:an |the |your )?(?:first )?order\b|\b(?:first|next) (?:[\w'’-]+ )?order\b|\bjust got (?:better|an upgrade)\b|\bfree food\b|\bdelivered to you\b|\bsigned, sealed\b)/i;

/**
 * What a shipping, delivery, return or cancellation subject from an unknown
 * sender has to mention to be about a purchase. Without it the lifecycle
 * keywords catch "Ye's return to Chicago", "Will Fanbase not return?",
 * "Elevator Car 1 - service is on the way" and "Did you ever cancel that old
 * subscription?", none of which can match an order and all of which waited in
 * review as "No matching order yet". Known merchants skip this check.
 */
const PURCHASE_CONTEXT =
  /\b(?:orders?|package|parcel|shipment|items?|purchase|delivery confirmation|tracking number|your refund|refund(?:ed)? (?:for|from|of|on)|return (?:confirmation|label|request|approved|received|started|submitted|processed|authori[sz]ation)|your (?:[\w'’-]+ ){0,2}return (?:is|has|was))\b/i;

/** Known-merchant subjects that still look like purchase mail (Ordered / order # / …). */
const MERCHANT_ORDERISH = /\border(?:ed)?\b/i;

function lifecycleFromSubject(subject: string): MessageClassification | null {
  if (CANCEL_SUBJECT.test(subject)) return 'cancellation';
  if (RETURN_SUBJECT.test(subject)) return 'return';
  if (DELIVERY_SUBJECT.test(subject)) return 'delivery';
  if (SHIPMENT_OF_ORDER.test(subject)) return 'shipping';
  if (SHIPPING_SUBJECT.test(subject) && !ORDER_SUBJECT.test(subject)) return 'shipping';
  return null;
}

/**
 * Tier A classifier: known merchant domains first, then subject heuristics.
 * Unknown personal mail becomes not_relevant without an LLM call.
 */
export function classifyMessage(input: ClassifyInput): ClassifyResult {
  const domain = domainFromAddress(input.fromAddress);
  const merchant = findMerchant(domain, input.merchants);
  const subject = input.subject ?? '';

  if (NOT_ORDER_SUBJECT.test(subject) || PROMO_SUBJECT.test(subject)) {
    return { classification: 'not_relevant', merchant, tier: merchant ? 'A' : 'none' };
  }

  const lifecycle = lifecycleFromSubject(subject);
  if (lifecycle) {
    if (!merchant && !PURCHASE_CONTEXT.test(subject)) {
      return { classification: 'not_relevant', merchant: null, tier: 'none' };
    }
    return { classification: lifecycle, merchant, tier: merchant ? 'A' : 'subject_heuristic' };
  }
  if (ORDER_SUBJECT.test(subject) || (merchant && MERCHANT_ORDERISH.test(subject))) {
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
