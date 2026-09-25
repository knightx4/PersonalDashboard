import 'server-only';

import { nextVisit, type VisitRecord } from '@/lib/goals/catch-up';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';

type VisitRow = {
  last_visit_at: string;
  away_from: string | null;
  back_on: string | null;
  previous_visit_at: string | null;
};

/**
 * Records a visit to the Goals home (plan #1019) and returns the record as it
 * now stands, which says whether today is a day back from time away. The rule
 * is nextVisit in lib/goals/catch-up.ts; row level security keeps the row to
 * the signed-in person.
 */
export async function recordVisit(
  client: GoalsSupabaseClient,
  { userId, today, now = new Date() }: { userId: string; today: string; now?: Date },
): Promise<VisitRecord> {
  const { data, error } = await client
    .from('visits')
    .select('last_visit_at, away_from, back_on, previous_visit_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Could not read your last visit: ${error.message}`);
  const row = data as VisitRow | null;
  const record = nextVisit(
    row
      ? {
          lastVisitAt: row.last_visit_at,
          awayFrom: row.away_from,
          backOn: row.back_on,
          previousVisitAt: row.previous_visit_at,
        }
      : null,
    now,
    today,
  );
  const { error: writeError } = await client.from('visits').upsert({
    user_id: userId,
    last_visit_at: record.lastVisitAt,
    away_from: record.awayFrom,
    back_on: record.backOn,
    previous_visit_at: record.previousVisitAt,
  });
  if (writeError) throw new Error(`Could not record this visit: ${writeError.message}`);
  return record;
}
