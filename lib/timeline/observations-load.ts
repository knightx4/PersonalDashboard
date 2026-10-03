import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  evidenceByTable,
  OBSERVATION_COLUMNS,
  showObservations,
  type ObservationRecord,
  type ShownObservation,
} from './observations-view';
import { TIMELINE_COLUMNS, withRefs, type TimelineEvent, type TimelineRow } from './timeline';

/** How many ids go in one `in (…)` read, so the request line stays short. */
const IDS_PER_READ = 100;

/**
 * The signed-in person's observations for the weeks whose Monday is in
 * [fromWeek, toWeek), with the rows behind each one (plan #1120). Pass the
 * request's own client: core.observations is read under RLS and
 * core.timeline is security_invoker. Marked not useful ones are left out.
 */
export async function readObservations(
  client: SupabaseClient,
  weeks: { fromWeek: string; toWeek: string },
): Promise<ShownObservation[]> {
  const { data, error } = await client
    .schema('core')
    .from('observations')
    .select(OBSERVATION_COLUMNS)
    .gte('week', weeks.fromWeek)
    .lt('week', weeks.toWeek)
    .or('verdict.is.null,verdict.neq.not_useful')
    .order('week', { ascending: false })
    .order('position', { ascending: true });
  if (error) throw new Error(`Could not read the observations: ${error.message}`);
  const records = (data ?? []) as unknown as ObservationRecord[];
  if (records.length === 0) return [];

  const reads: Promise<TimelineEvent[]>[] = [];
  for (const [table, ids] of evidenceByTable(records)) {
    for (let at = 0; at < ids.length; at += IDS_PER_READ) {
      reads.push(
        (async () => {
          const { data: rows, error: readError } = await client
            .schema('core')
            .from('timeline')
            .select(TIMELINE_COLUMNS)
            .eq('source_table', table)
            .in('source_id', ids.slice(at, at + IDS_PER_READ));
          if (readError) throw new Error(`Could not read the timeline: ${readError.message}`);
          return withRefs((rows ?? []) as unknown as TimelineRow[]);
        })(),
      );
    }
  }
  const events = (await Promise.all(reads)).flat();
  return showObservations(records, events);
}
