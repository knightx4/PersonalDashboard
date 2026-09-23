/**
 * Seeded "merchants" that are email platforms, not the store the user bought from.
 * Shopify boutiques send via shopifyemail.com and classify as Shopify — the real
 * merchant is the From display name / body ("Goods of Desire"), not Shopify itself.
 */
export const PLATFORM_MERCHANT_SLUGS = new Set(['shopify']);

/** Sender domains shared by many boutiques — never use them to identity-match a store. */
export const PLATFORM_SENDER_DOMAINS = ['shopifyemail.com', 'shopify.com'] as const;

export function isPlatformMerchantSlug(slug: string | null | undefined): boolean {
  if (!slug) return false;
  return PLATFORM_MERCHANT_SLUGS.has(slug.toLowerCase());
}

export function isPlatformMerchantName(name: string | null | undefined): boolean {
  if (!name) return false;
  return PLATFORM_MERCHANT_SLUGS.has(name.trim().toLowerCase());
}

export function isPlatformSenderDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  const lower = domain.toLowerCase();
  return PLATFORM_SENDER_DOMAINS.some((d) => lower === d || lower.endsWith(`.${d}`));
}

/**
 * Sender domains that many unrelated shops share, so muting one mutes them all.
 *
 * The platform domains above, plus the payment processors, help desks, bulk
 * mail services and personal mailbox providers that shop receipts are often
 * sent from or reply to. Excluding paypal.com to be rid of one seller would
 * silence every PayPal receipt; excluding zendesk.com would silence every shop
 * whose support desk answers from it. The review queue refuses these rather
 * than write a mute that reaches further than the person meant.
 */
export const SHARED_SENDER_DOMAINS = [
  ...PLATFORM_SENDER_DOMAINS,
  'paypal.com',
  'stripe.com',
  'squareup.com',
  'square.com',
  'klarna.com',
  'afterpay.com',
  'etsy.com',
  'ebay.com',
  'zendesk.com',
  'gorgias.com',
  'freshdesk.com',
  'helpscout.net',
  'klaviyomail.com',
  'sendgrid.net',
  'mailchimpapp.net',
  'amazonses.com',
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'yahoo.com',
  'icloud.com',
] as const;

export function isSharedSenderDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  const lower = domain.toLowerCase();
  return SHARED_SENDER_DOMAINS.some((d) => lower === d || lower.endsWith(`.${d}`));
}
