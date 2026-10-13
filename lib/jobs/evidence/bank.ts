import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeSkills } from './propose-payload';

/**
 * Putting items in the evidence bank (`job_search.evidence_items`). The
 * Material page's bulk add and Learn's Finish on an essay (plan #1873) both
 * insert through here, on the person's own session so RLS decides whose rows
 * they are.
 */

export type NewEvidenceItem = {
  title: string;
  body: string;
  context?: string | null;
  metrics?: string | null;
  strength?: number;
  skills?: readonly string[];
};

export type AddedEvidence = { ok: true; ids: string[] } | { ok: false; error: string };

// The jobs client is typed to its own schema; the table is reached by name.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JobsClient = Pick<SupabaseClient<any, any, any>, 'from'>;

export async function addEvidenceItems(
  supabase: JobsClient,
  userId: string,
  items: readonly NewEvidenceItem[],
): Promise<AddedEvidence> {
  if (items.length === 0) return { ok: true, ids: [] };
  const { data, error } = await supabase
    .from('evidence_items')
    .insert(
      items.map((item) => ({
        user_id: userId,
        title: item.title,
        body: item.body,
        context: item.context || null,
        metrics: item.metrics || null,
        strength: item.strength ?? 3,
        skills: normalizeSkills(item.skills ?? []),
      })),
    )
    .select('id');
  if (error) return { ok: false, error: error.message };
  return { ok: true, ids: ((data ?? []) as { id: string }[]).map((row) => row.id) };
}
