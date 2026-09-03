/**
 * Verify eBay Browse API credentials end to end.
 *
 *   npm run check:ebay -- 9780735211292
 *
 * Gets an application token, runs one Browse search, and prints what the sell
 * assistant would use as the expected list price — or, when that fails, the
 * reason eBay gave, which is the whole point of running this.
 */
import { existsSync } from 'node:fs';
import { config as loadEnvFile } from 'dotenv';
import {
  EbayBrowseExpectedPriceSource,
  ebayKeysetEnvironment,
} from '../lib/sell/expected-price';
import { formatMoney } from '../lib/money';

/**
 * Load the dotenv files by hand.
 *
 * Next does this for the app, so nothing else in the repo needs to — which is
 * exactly why running this script the obvious way reports both keys MISSING
 * while they sit in .env.local, and the first thing you debug is the debugger.
 * dotenv does not override what is already exported, so an inline
 * `EBAY_CLIENT_ID=… npm run check:ebay` still wins.
 */
function loadEnvironment(): string[] {
  const loaded: string[] = [];
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue;
    loadEnvFile({ path: file, quiet: true });
    loaded.push(file);
  }
  return loaded;
}

async function main(): Promise<void> {
  const loaded = loadEnvironment();
  const isbn = process.argv[2] ?? '9780735211292';
  const rawId = process.env.EBAY_CLIENT_ID ?? '';
  const rawSecret = process.env.EBAY_CLIENT_SECRET ?? '';

  console.log('env files    :', loaded.length ? loaded.join(', ') : 'none found');
  console.log('client id    :', rawId ? `${rawId.slice(0, 12)}…` : 'MISSING');
  console.log('client secret:', rawSecret ? 'set' : 'MISSING');
  if (!rawId || !rawSecret) {
    console.error('\nSet EBAY_CLIENT_ID and EBAY_CLIENT_SECRET, then re-run.');
    console.error('To test the same values the deployment uses, pull them down first:');
    console.error('  npx vercel link && npx vercel env pull .env.local');
    console.error('On Vercel these must be set for the environment you are testing,');
    console.error('and a redeploy is required before a running deployment sees them.');
    process.exit(1);
  }

  // Whitespace in a pasted key is invisible in a dashboard and fatal here, so
  // say it out loud before the request goes anywhere.
  if (rawId !== rawId.trim() || rawSecret !== rawSecret.trim()) {
    console.warn('\nWarning: a credential has leading/trailing whitespace. The source');
    console.warn('trims it, but the copy stored in your host probably has it too.');
  }

  const environment = ebayKeysetEnvironment(rawId);
  console.log('keyset       :', environment);
  if (environment === 'sandbox') {
    console.error('\nThis is a sandbox keyset. Sandbox returns invented listings, so the');
    console.error('sell assistant refuses it. Use the production keyset instead.');
    process.exit(1);
  }
  if (environment === 'unknown') {
    console.warn('\nWarning: this client id carries neither -PRD- nor -SBX-, so it does');
    console.warn('not look like an eBay keyset. Check you copied the App ID (Client ID).');
  }

  const source = new EbayBrowseExpectedPriceSource({
    clientId: rawId,
    clientSecret: rawSecret,
  });

  console.log('\nquerying Browse for', isbn, '…');
  const cents = await source.expectedSelfListCents(isbn);

  if (cents == null) {
    const failure = source.lastFailure;
    console.log('result       : no usable price');
    console.log('stage        :', failure?.stage ?? 'unknown');
    if (failure?.status) console.log('http status  :', failure.status);
    console.log('reason       :', failure?.detail ?? 'no reason recorded');
    // Only `no_results` is about the book; every other stage is configuration.
    process.exit(failure?.stage === 'no_results' ? 0 : 1);
  }
  console.log('result       :', formatMoney(cents), '(25th percentile of active asks)');
  console.log('\nCredentials work. The sell assistant will use eBay Browse.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
