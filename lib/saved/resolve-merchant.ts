/**
 * Match a product URL hostname to a seeded merchant via domains[].
 * Same suffix rule as email Tier A classify.
 */
export interface MerchantDomainHit {
  id: string;
  slug: string;
  name: string;
  domains: string[];
}

export function hostnameFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

export function findMerchantByHostname(
  hostname: string | null,
  merchants: readonly MerchantDomainHit[],
): MerchantDomainHit | null {
  if (!hostname) return null;
  for (const merchant of merchants) {
    for (const d of merchant.domains) {
      const needle = d.toLowerCase();
      if (hostname === needle || hostname.endsWith(`.${needle}`)) return merchant;
    }
  }
  return null;
}

export function findMerchantByUrl(
  rawUrl: string,
  merchants: readonly MerchantDomainHit[],
): MerchantDomainHit | null {
  return findMerchantByHostname(hostnameFromUrl(rawUrl), merchants);
}
