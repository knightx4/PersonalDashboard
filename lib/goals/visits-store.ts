import 'server-only';

import { nextVisit, type VisitRecord } from '@/lib/goals/catch-up';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { nextVisitDays } from '@/lib/goals/home';

type VisitRow = {
  last_visit_at: string;
  away_from: string | null;
  back_on: string | null;
  previous_visit_at: string | null;
  visit_days: string[] | null;
};

/**
 * Records a visit to the Goals home (plan #1019) and returns the record as it
 * now stands, which says whether today is a day back from time away. The rule
 * is nextVisit in lib/goals/catch-up.ts; row level security keeps the row to
 * the signed-in person. It also adds today to the days you visited (plan
 * #1079, nextVisitDays), which the home counts for the week.
 */
export async function recordVisit(
  client: GoalsSupabaseClient,
  { userId, today, now = new Date() }: { userId: string; today: string; now?: Date },
): Promise<VisitRecord & { visitDays: string[] }> {
  const { data, error } = await client
    .from('visits')
    .select('last_visit_at, away_from, back_on, previous_visit_at, visit_days')
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
  const visitDays = nextVisitDays(row?.visit_days ?? [], today);
  const { error: writeError } = await client.from('visits').upsert({
    user_id: userId,
    last_visit_at: record.lastVisitAt,
    away_from: record.awayFrom,
    back_on: record.backOn,
    previous_visit_at: record.previousVisitAt,
    visit_days: visitDays,
  });
  if (writeError) throw new Error(`Could not record this visit: ${writeError.message}`);
  return { ...record, visitDays };
}
