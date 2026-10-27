/**
 * Print the Supabase project ref this checkout talks to (lib/db/project.ts),
 * for the Supabase connector's project_id:
 *
 *   npx tsx scripts/project-ref.ts
 */
import { supabaseProjectRef } from '../lib/db/project';

const ref = supabaseProjectRef();
if (!ref) {
  console.error(
    'No Supabase project is named. Set NEXT_PUBLIC_SUPABASE_URL or SUPABASE_PROJECT_REF.',
  );
  process.exit(1);
}
console.log(ref);
