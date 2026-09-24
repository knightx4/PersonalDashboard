import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  AIM_COLUMNS,
  LEVEL3_AIM_NAME,
  toAim,
  type Aim,
  type Level3Counts,
  type AimFields,
  type AimRow,
} from '@/lib/learn/aims';

/**
 * Reads and writes of learn.aims, on the person's own session (plan #897).
 *
 * RLS keeps every row to its owner, so the reads name no user. The inserts
 * name one because the column has no default.
 */

/** The goals still in play, oldest first, so a new one lands at the bottom. */
export async function loadActiveAims(supabase: LearnSupabaseClient): Promise<Aim[]> {
  const { data, error } = await supabase
    .from('aims')
    .select(AIM_COLUMNS)
    .is('archived_at', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Could not read your goals: ${error.message}`);
  return ((data ?? []) as AimRow[]).map(toAim);
}

export async function insertAim(
  supabase: LearnSupabaseClient,
  userId: string,
  fields: AimFields,
): Promise<string> {
  const { data, error } = await supabase
    .from('aims')
    .insert({ user_id: userId, name: fields.name, about: fields.about, depth: fields.depth })
    .select('id')
    .single();
  if (error) throw new Error(`Could not save the goal: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * The ready-made Level 3 goal. `already` when an active one exists: the
 * partial unique index aims_user_list_active_uq refuses a second.
 */
export async function insertLevel3Aim(
  supabase: LearnSupabaseClient,
  userId: string,
): Promise<'added' | 'already'> {
  const { error } = await supabase.from('aims').insert({
    user_id: userId,
    name: LEVEL3_AIM_NAME,
    depth: 'familiar',
    list_source: 'level3',
  });
  if (!error) return 'added';
  if (error.code === '23505') return 'already';
  throw new Error(`Could not save the goal: ${error.message}`);
}

/** What a reworded goal's placement goes back to, so it is placed again (#898). */
const UNPLACED = {
  field_id: null,
  domain_id: null,
  placement_confidence: null,
  placement_basis: null,
  placement_model: null,
  placed_at: null,
} as const;

/** True when an edit changes what placement reads: the name or the line. */
export function rewordsAim(fields: Partial<AimFields>): boolean {
  return 'name' in fields || 'about' in fields;
}

/**
 * Change what an edit sent. False when no active goal of theirs matched.
 * A new name or line clears the placement, for the caller to place again.
 */
export async function updateAim(
  supabase: LearnSupabaseClient,
  id: string,
  fields: Partial<AimFields>,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('aims')
    .update(rewordsAim(fields) ? { ...fields, ...UNPLACED } : fields)
    .eq('id', id)
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(`Could not change the goal: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Take a goal out of the list, keeping the row for the cards drawn for it. */
export async function archiveAim(supabase: LearnSupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('aims')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(`Could not archive the goal: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * The names of the fields and domains the goals are placed in, by id, for
 * the line under each goal. Empty when nothing is placed.
 */
export async function loadAimAreaNames(
  supabase: LearnSupabaseClient,
  aims: Aim[],
): Promise<Map<string, string>> {
  const fieldIds = [...new Set(aims.flatMap((aim) => (aim.fieldId ? [aim.fieldId] : [])))];
  const domainIds = [...new Set(aims.flatMap((aim) => (aim.domainId ? [aim.domainId] : [])))];
  const [fields, domains] = await Promise.all([
    fieldIds.length > 0
      ? supabase.from('area_fields').select('id, name').in('id', fieldIds)
      : { data: [], error: null },
    domainIds.length > 0
      ? supabase.from('area_domains').select('id, name').in('id', domainIds)
      : { data: [], error: null },
  ]);
  if (fields.error) throw new Error(`Could not read the fields: ${fields.error.message}`);
  if (domains.error) throw new Error(`Could not read the domains: ${domains.error.message}`);
  const rows = [...(fields.data ?? []), ...(domains.data ?? [])] as { id: string; name: string }[];
  return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * Your claimed and tested counts on the Level 3 list, and its size (#906).
 * Grouped by article in the database, so every kind of evidence the view
 * gains counts without this changing.
 */
export async function loadLevel3Counts(supabase: LearnSupabaseClient): Promise<Level3Counts> {
  const { data, error } = await supabase.rpc('level3_evidence_counts').single();
  if (error) throw new Error(`Could not count your Level 3 articles: ${error.message}`);
  const row = data as { claimed: number | string; tested: number | string; total: number | string };
  return { claimed: Number(row.claimed), tested: Number(row.tested), total: Number(row.total) };
}
