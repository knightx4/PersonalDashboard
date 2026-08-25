/**
 * Diagnose one ISBN or title against the live resolver.
 *
 *   npx tsx scripts/resolve-book.ts 9781637635568
 *
 * Prints which providers failed, so "no match" can be told apart from
 * "Google Books is rate-limiting this IP".
 */
import { resolveBookDetailed } from '../lib/books/resolve';
import { normalizeIsbn } from '../lib/books/isbn';

async function main(): Promise<void> {
  const query = process.argv.slice(2).join(' ').trim();
  if (!query) {
    console.error('usage: npx tsx scripts/resolve-book.ts <isbn|title>');
    process.exit(1);
  }

  const isbn = normalizeIsbn(query);
  const keys = {
    googleBooksApiKey: process.env.GOOGLE_BOOKS_API_KEY ?? null,
    isbndbApiKey: process.env.ISBNDB_API_KEY ?? null,
  };
  console.log('query        :', query);
  console.log('parsed ISBN  :', isbn ? `${isbn.isbn13} / ${isbn.isbn10}` : '(not an ISBN)');
  console.log('google key   :', keys.googleBooksApiKey ? 'set' : 'MISSING (shared quota)');
  console.log('isbndb key   :', keys.isbndbApiKey ? 'set' : 'not set');

  const outcome = await resolveBookDetailed(
    isbn ? { isbn: isbn.isbn13 } : { title: query },
    keys,
  );

  console.log('\nfailures     :', outcome.failures.length ? outcome.failures : 'none');
  console.log('book         :', outcome.book ?? 'NOT FOUND');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
