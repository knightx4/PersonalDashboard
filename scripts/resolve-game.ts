/**
 * Diagnose one game barcode or title against the live resolver.
 *
 *   npx tsx scripts/resolve-game.ts 810011725195
 *   npx tsx scripts/resolve-game.ts "Pandemic Legacy Season 1"
 *
 * Prints provider failures separately from a genuine miss.
 */
import { resolveGameDetailed } from '../lib/games/resolve';
import { classifyScannedCode } from '../lib/barcodes/scan-code';

async function main(): Promise<void> {
  const query = process.argv.slice(2).join(' ').trim();
  if (!query) {
    console.error('usage: npx tsx scripts/resolve-game.ts <barcode|title>');
    process.exit(1);
  }

  const code = classifyScannedCode(query);
  console.log('query      :', query);
  console.log('scanned as :', code ? code.kind : 'title (not a barcode)');
  console.log('upc key    :', process.env.UPCITEMDB_API_KEY ? 'set' : 'not set (trial endpoint)');

  const outcome = await resolveGameDetailed(
    code?.kind === 'product' ? { barcode: code.ean13 } : { title: query },
    { upcApiKey: process.env.UPCITEMDB_API_KEY ?? null },
  );

  if (outcome.productTitle) console.log('upc says   :', outcome.productTitle);
  console.log('failures   :', outcome.failures.length ? outcome.failures : 'none');
  console.log('game       :', outcome.game ?? 'NOT FOUND');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
