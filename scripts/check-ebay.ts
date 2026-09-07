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
import { checkEbayConnection, EBAY_CHECK_ISBN } from '../lib/sell/ebay-check';
import { ebayKeysetEnvironment } from '../lib/sell/expected-price';
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
  const isbn = process.argv[2] ?? EBAY_CHECK_ISBN;
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

  console.log('keyset       :', ebayKeysetEnvironment(rawId));

  console.log('\nquerying Browse for', isbn, '…');
  const result = await checkEbayConnection({
    clientId: rawId,
    clientSecret: rawSecret,
    isbn,
  });

  console.log('result       :', result.headline);
  if (result.priceCents != null) {
    console.log('price        :', formatMoney(result.priceCents), '(the price the assistant would use)');
  }
  if (result.stage !== 'ok') console.log('stage        :', result.stage);
  if (result.status) console.log('http status  :', result.status);
  console.log('detail       :', result.detail);
  if (result.hint) console.log('\n' + result.hint);

  // `no_results` is about the book, not the setup, so it is not a failure to
  // script against -- CI can treat a non-zero exit as "the integration is broken".
  if (!result.ok && result.stage !== 'no_results') process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
