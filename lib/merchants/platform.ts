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
