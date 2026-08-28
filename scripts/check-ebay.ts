/**
 * Verify eBay Browse API credentials end to end.
 *
 *   npx tsx scripts/check-ebay.ts 9780735211292
 *
 * Gets an application token, runs one Browse search, and prints what the
 * sell assistant would use as the expected list price.
 */
import { createExpectedPriceSource } from '../lib/sell/expected-price';
import { formatMoney } from '../lib/money';

async function main(): Promise<void> {
  const isbn = process.argv[2] ?? '9780735211292';
  const clientId = process.env.EBAY_CLIENT_ID ?? null;
  const clientSecret = process.env.EBAY_CLIENT_SECRET ?? null;

  console.log('client id    :', clientId ? `${clientId.slice(0, 12)}…` : 'MISSING');
  console.log('client secret:', clientSecret ? 'set' : 'MISSING');
  if (!clientId || !clientSecret) {
    console.error('\nSet EBAY_CLIENT_ID and EBAY_CLIENT_SECRET, then re-run.');
    process.exit(1);
  }
  if (!clientId.includes('PRD')) {
    console.warn('\nWarning: this looks like a sandbox keyset. Sandbox returns fake');
    console.warn('listings, so prices from it are meaningless.');
  }

  const source = await createExpectedPriceSource({
    ebayClientId: clientId,
    ebayClientSecret: clientSecret,
  });

  console.log('\nquerying Browse for', isbn, '…');
  const cents = await source.expectedSelfListCents(isbn);

  if (cents == null) {
    console.log('result       : no usable price');
    console.log('\nA null here means one of: no active listings for that ISBN,');
    console.log('the OAuth token was refused, or Browse returned no USD prices.');
    return;
  }
  console.log('result       :', formatMoney(cents), '(25th percentile of active asks)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
