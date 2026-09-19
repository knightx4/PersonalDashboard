/**
 * Put a Wikipedia article in the catalogue.
 *
 *   npm run catalogue -- "Marginal utility"
 *   npm run catalogue -- "Marginal utility" "Indifference curve"
 *
 * One article becomes one `learn.catalogue_items` row and one
 * `learn.catalogue_segments` row per section, each carrying the section's
 * anchor, its heading and its text. Running it again on the same article
 * updates those rows rather than adding more, and drops the sections the
 * article no longer has.
 *
 * Nothing is embedded here. The segments land with a null `embedding`, which
 * is what the next pass looks for.
 *
 * Two things about how it is run.
 *
 * `--conditions=react-server`, which is what the npm script adds, is there
 * because the fetch path is a `server-only` module and that package throws on
 * import under plain node. The flag picks its empty build, the same one Next
 * resolves on the server. Without it this script cannot import the one module
 * allowed to reach the web.
 *
 * A direct `postgres` connection rather than lib/db/admin.ts, matching
 * scripts/learn-graph-seed.ts and scripts/notes.ts: that module is server-only
 * too, and wants Drizzle's public-schema types. Same service-role credentials.
 * The catalogue tables carry no user id, so there is nothing here to filter by
 * -- they are reference data, shared by every account, and that is the whole
 * reason the sweeps run privileged.
 */
import postgres from 'postgres';
import { sweepWikipediaArticle } from '../lib/learn/catalogue/sweep';

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  return postgres(url, { max: 2, prepare: false, onnotice: () => {} });
}

async function main(): Promise<void> {
  const titles = process.argv.slice(2).filter((arg) => arg.trim() !== '');
  if (titles.length === 0) {
    console.error('Usage: npm run catalogue -- "Marginal utility" ["Indifference curve" ...]');
    process.exit(1);
  }

  const sql = db();
  let failed = 0;

  for (const title of titles) {
    const result = await sweepWikipediaArticle(sql, title);
    if (!result.ok) {
      failed += 1;
      console.error(`${title}: ${result.reason} -- ${result.detail}`);
      continue;
    }
    const dropped = result.removed > 0 ? `, ${result.removed} dropped` : '';
    console.log(`${result.title}: ${result.written} segments${dropped}`);
  }

  await sql.end();
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
