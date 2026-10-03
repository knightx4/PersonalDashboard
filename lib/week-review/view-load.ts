import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { TIMELINE_COLUMNS, withRefs, type TimelineEvent, type TimelineRow } from '@/lib/timeline/timeline';
import { addDays } from '@/lib/todo/tasks/model';
import {
  reviewEvidenceByTable,
  showWeekReview,
  WEEK_REVIEW_COLUMNS,
  type ShownWeekReview,
  type WeekReviewRecord,
} from './view';

/** How many ids go in one `in (…)` read, so the request line stays short. */
const IDS_PER_READ = 100;

export type WeekPage = {
  /** The review for the week asked for, or the newest one; null when there is none. */
  review: ShownWeekReview | null;
  /** Every week with a review, newest first. */
  weeks: string[];
};

/**
 * The Week page's reads (plan #1233). Pass the request's own client:
 * core.week_reviews is read under RLS and core.timeline is security_invoker.
 * With no week, the newest review is shown.
 */
export async function readWeekPage(client: SupabaseClient, week: string | null): Promise<WeekPage> {
  const reviews = client.schema('core').from('week_reviews');
  const { data: listed, error: listError } = await reviews.select('week').order('week', { ascending: false });
  if (listError) throw new Error(`Could not read the weekly reviews: ${listError.message}`);
  const weeks = (listed ?? []).map((row) => String((row as { week: string }).week));

  const wanted = week ?? weeks[0] ?? null;
  if (!wanted || !weeks.includes(wanted)) return { review: null, weeks };

  const [current, previous] = await Promise.all([
    client.schema('core').from('week_reviews').select(WEEK_REVIEW_COLUMNS).eq('week', wanted).maybeSingle(),
    weeks.includes(addDays(wanted, -7))
      ? client.schema('core').from('week_reviews').select('change').eq('week', addDays(wanted, -7)).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (current.error) throw new Error(`Could not read the weekly review: ${current.error.message}`);
  if (!current.data) return { review: null, weeks };
  const record = current.data as unknown as WeekReviewRecord;
  const previousChange = (previous.data as { change: string | null } | null)?.change ?? null;

  const reads: Promise<TimelineEvent[]>[] = [];
  for (const [table, ids] of reviewEvidenceByTable(record.observations ?? [])) {
    for (let at = 0; at < ids.length; at += IDS_PER_READ) {
      reads.push(
        (async () => {
          const { data: rows, error } = await client
            .schema('core')
            .from('timeline')
            .select(TIMELINE_COLUMNS)
            .eq('source_table', table)
            .in('source_id', ids.slice(at, at + IDS_PER_READ));
          if (error) throw new Error(`Could not read the timeline: ${error.message}`);
          return withRefs((rows ?? []) as unknown as TimelineRow[]);
        })(),
      );
    }
  }
  // The rows behind an observation are a fold under it; losing them costs the
  // fold its contents, not the page.
  const events = (await Promise.all(reads).catch(() => [])).flat();
  return { review: showWeekReview(record, previousChange, events), weeks };
}
