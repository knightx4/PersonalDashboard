import { domainFromAddress } from '@/lib/email/extract/classify';

export type MerchantExclusionRow = {
  merchant_id: string | null;
  match_domain: string | null;
};

export function isExcludedSender(
  exclusions: readonly MerchantExclusionRow[],
  opts: { merchantId: string | null; fromAddress: string | null },
): boolean {
  if (exclusions.length === 0) return false;

  if (opts.merchantId) {
    for (const row of exclusions) {
      if (row.merchant_id === opts.merchantId) return true;
    }
  }

  const domain = domainFromAddress(opts.fromAddress);
  if (!domain) return false;

  for (const row of exclusions) {
    const needle = row.match_domain?.toLowerCase();
    if (!needle) continue;
    if (domain === needle || domain.endsWith(`.${needle}`)) return true;
  }

  return false;
}
