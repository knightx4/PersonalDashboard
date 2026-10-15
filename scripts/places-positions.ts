/**
 * Put every place that has no map position on the map from its city
 * (plan #2091.3), once, for the places saved before saving did it.
 *
 *   npx tsx scripts/places-positions.ts --dry-run
 *   npx tsx scripts/places-positions.ts
 *
 * Reads you.places for every account where latitude is empty, looks each
 * city up in the bundled list (lib/you/place-position.ts, nothing sent
 * anywhere), and writes the position of each one it finds. A place whose city
 * is not in the list is left empty and named in the output. A place that
 * already has a position is never read, so one set by hand is untouched.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, from the
 * environment or from .env.local and .env. `--dry-run` prints what it would
 * write and writes nothing.
 */
import { existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnvFile } from 'dotenv';
import { placePosition } from '../lib/you/place-position';

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) loadEnvFile({ path: file, quiet: true });
}

const dryRun = process.argv.includes('--dry-run');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://asjztutnqxbecruvyrbj.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set. It is needed to read every account’s places.');
  process.exit(1);
}

type Row = { id: string; user_id: string; city: string | null; region: string | null; country: string | null };

async function main(): Promise<void> {
  const you = createClient(url, key!, { db: { schema: 'you' }, auth: { persistSession: false } });
  const { data, error } = await you
    .from('places')
    .select('id, user_id, city, region, country')
    .is('latitude', null);
  if (error) throw new Error(`Reading the places failed: ${error.message}`);

  let placed = 0;
  for (const row of (data ?? []) as Row[]) {
    const where = [row.city, row.region, row.country].filter(Boolean).join(', ') || '(no city)';
    const position = placePosition(row);
    if (!position) {
      console.log(`not found  ${row.id}  ${where}`);
      continue;
    }
    console.log(`${dryRun ? 'would set' : 'set      '}  ${row.id}  ${where}  ${position.latitude}, ${position.longitude}`);
    placed += 1;
    if (dryRun) continue;
    const { error: writeError } = await you
      .from('places')
      .update(position)
      .eq('id', row.id)
      .eq('user_id', row.user_id)
      .is('latitude', null);
    if (writeError) throw new Error(`Writing ${row.id} failed: ${writeError.message}`);
  }
  console.log(`${dryRun ? 'Dry run: would place ' : 'Placed '}${placed} of ${(data ?? []).length} without a position.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
