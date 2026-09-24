import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  AIM_COLUMNS,
  LEVEL3_AIM_NAME,
  toAim,
  type Aim,
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

/** Change what an edit sent. False when no active goal of theirs matched. */
export async function updateAim(
  supabase: LearnSupabaseClient,
  id: string,
  fields: Partial<AimFields>,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('aims')
    .update(fields)
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
