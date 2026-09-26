import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { BRIEF_COLUMNS, toBrief, type Brief, type BriefRow } from './briefs';

/**
 * The newest note for one place: a goal by its id, or the Goals home with
 * null. Row level security scopes it to the person.
 */
export async function loadBrief(
  client: GoalsSupabaseClient,
  itemId: string | null,
): Promise<Brief | null> {
  let query = client.from('briefs').select(BRIEF_COLUMNS);
  query = itemId === null ? query.is('item_id', null) : query.eq('item_id', itemId);
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not read Claude's note: ${error.message}`);
  return data ? toBrief(data as BriefRow) : null;
}
