'use server';

import { revalidatePath } from 'next/cache';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { addThoughtRow, saveThoughtEdit, THOUGHT_MAX } from '@/lib/jobs/thoughts';
import { formatNumber } from '@/lib/money';

/**
 * The career goals entries (job_search.thoughts, 0026), written on Settings.
 * The roles and people searches read them, and Find's setup list asks for one
 * until there is one, so both pages are refreshed.
 */
function revalidateGoals() {
  revalidatePath('/jobs/settings');
  revalidatePath('/jobs/find');
}

export interface ThoughtState {
  error: string | null;
}

function check(body: string): string | null {
  if (!body.trim()) return 'Write something first.';
  if (body.length > THOUGHT_MAX) return `Keep an entry under ${formatNumber(THOUGHT_MAX)} characters.`;
  return null;
}

/** A new dated entry. Older ones stay as they were. */
// latency: pending
export async function addThought(_prev: ThoughtState, form: FormData): Promise<ThoughtState> {
  const body = String(form.get('body') ?? '');
  const invalid = check(body);
  if (invalid) return { error: invalid };

  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await addThoughtRow(supabase, user.id, body);
  if (error) return { error };

  revalidateGoals();
  return { error: null };
}

// latency: pending
export async function updateThought(id: string, body: string): Promise<{ error: string | null }> {
  const invalid = check(body);
  if (invalid) return { error: invalid };

  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await saveThoughtEdit(supabase, user.id, id, body);
  if (error) return { error };

  revalidateGoals();
  return { error: null };
}

// latency: pending
export async function deleteThought(id: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from('thoughts').delete().eq('id', id).eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidateGoals();
  return { error: null };
}
