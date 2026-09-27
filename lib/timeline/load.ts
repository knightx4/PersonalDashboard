import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { TIMELINE_COLUMNS, type TimelineEvent, type TimelineModule } from './timeline';

export type TimelineQuery = {
  /** Inclusive lower bound on occurred_at, as an ISO timestamp. */
  from?: string;
  /** Exclusive upper bound on occurred_at, as an ISO timestamp. */
  to?: string;
  /** Only these modules; all of them when absent. */
  modules?: readonly TimelineModule[];
  /** Newest first when true; oldest first otherwise. */
  newestFirst?: boolean;
};

/**
 * Read the signed-in person's timeline from core.timeline, in date order.
 * The view is security_invoker, so the client's own session decides whose
 * rows come back; pass the request's client, not the service-role one.
 *
 * PostgREST caps a response at its max-rows setting, so this pages through
 * until a short page comes back rather than trusting one read to be whole.
 */
export async function readTimeline(
  client: SupabaseClient,
  query: TimelineQuery = {},
): Promise<TimelineEvent[]> {
  const pageSize = 1000;
  const events: TimelineEvent[] = [];
  for (let offset = 0; ; offset += pageSize) {
    let request = client.schema('core').from('timeline').select(TIMELINE_COLUMNS);
    if (query.from) request = request.gte('occurred_at', query.from);
    if (query.to) request = request.lt('occurred_at', query.to);
    if (query.modules && query.modules.length > 0) request = request.in('module', [...query.modules]);
    const { data, error } = await request
      .order('occurred_at', { ascending: !query.newestFirst })
      .order('source_id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`Could not read the timeline: ${error.message}`);
    const page = (data ?? []) as unknown as TimelineEvent[];
    events.push(...page);
    if (page.length < pageSize) return events;
  }
}
