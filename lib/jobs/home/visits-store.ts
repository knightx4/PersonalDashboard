import 'server-only';

import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { nextHomeVisit, type HomeVisit } from '@/lib/jobs/home/since';

/**
 * Records a visit to the Jobs home (plan #1152) and returns the record as it
 * now stands. The rule is nextHomeVisit in lib/jobs/home/since.ts; row level
 * security keeps the row to the signed-in person.
 */
export async function recordHomeVisit(
  client: AppSupabaseClient,
  { userId, now = new Date() }: { userId: string; now?: Date },
): Promise<HomeVisit> {
  const { data, error } = await client
    .from('home_visits')
    .select('last_visit_at, previous_visit_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Could not read your last visit: ${error.message}`);
  const row = data as { last_visit_at: string; previous_visit_at: string | null } | null;
  const record = nextHomeVisit(
    row ? { lastVisitAt: row.last_visit_at, previousVisitAt: row.previous_visit_at } : null,
    now,
  );
  const { error: writeError } = await client.from('home_visits').upsert(
    {
      user_id: userId,
      last_visit_at: record.lastVisitAt,
      previous_visit_at: record.previousVisitAt,
    },
    { onConflict: 'user_id' },
  );
  if (writeError) throw new Error(`Could not record this visit: ${writeError.message}`);
  return record;
}
