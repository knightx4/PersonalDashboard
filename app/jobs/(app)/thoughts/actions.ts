'use server';

import { revalidatePath } from 'next/cache';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { THOUGHT_MAX } from '@/lib/jobs/thoughts';

export interface ThoughtState {
  error: string | null;
}

function check(body: string): string | null {
  if (!body.trim()) return 'Write something first.';
  if (body.length > THOUGHT_MAX) return `Keep an entry under ${THOUGHT_MAX.toLocaleString('en-GB')} characters.`;
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
  const { error } = await supabase.from('thoughts').insert({ user_id: user.id, body: body.trim() });
  if (error) return { error: error.message };

  revalidatePath('/jobs/thoughts');
  return { error: null };
}

// latency: pending
export async function updateThought(id: string, body: string): Promise<{ error: string | null }> {
  const invalid = check(body);
  if (invalid) return { error: invalid };

  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from('thoughts')
    .update({ body: body.trim() })
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/jobs/thoughts');
  return { error: null };
}

// latency: pending
export async function deleteThought(id: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from('thoughts').delete().eq('id', id).eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/jobs/thoughts');
  return { error: null };
}
