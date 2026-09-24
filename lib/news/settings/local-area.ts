import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { NEWS_SCHEMA, type NewsSupabaseClient } from '@/lib/news/db/schema-name';

/**
 * Where you live, for the Local topic (note 552a9407).
 *
 * One row per person in news.preferences (0011_local_area.sql). The
 * summariser reads it for every newsletter and tags a story about this place
 * Local; with none set, nothing is.
 */

/** The longest area the table's check allows. */
export const LOCAL_AREA_MAX = 80;

/** What was typed, trimmed, or null to clear it. */
export function readLocalArea(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const area = value.replace(/\s+/g, ' ').trim();
  return area ? area.slice(0, LOCAL_AREA_MAX) : null;
}

/** The session's own row by the table's policy, so nothing here filters by user. */
export async function loadLocalArea(client: NewsSupabaseClient): Promise<string | null> {
  const { data, error } = await client.from('preferences').select('local_area').maybeSingle();
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: reading your local area failed (${error.message})`);
  return (data?.local_area as string | null | undefined) ?? null;
}

export async function saveLocalArea(
  client: NewsSupabaseClient,
  { userId, area }: { userId: string; area: string | null },
): Promise<void> {
  const { error } = await client
    .from('preferences')
    .upsert(
      { user_id: userId, local_area: area, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: saving your local area failed (${error.message})`);
}
