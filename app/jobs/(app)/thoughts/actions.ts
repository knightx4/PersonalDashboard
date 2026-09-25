'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';

const body = z
  .string()
  .trim()
  .min(1, 'Write something first.')
  .max(20000, 'That is longer than one entry holds. Split it in two.');

// latency: pending
export async function addThought(input: string): Promise<{ error: string | null }> {
  const parsed = body.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from('thoughts')
    .insert({ user_id: user.id, body: parsed.data });

  if (error) return { error: error.message };
  revalidatePath('/jobs/thoughts');
  return { error: null };
}

// latency: pending
export async function updateThought(id: string, input: string): Promise<{ error: string | null }> {
  const parsed = body.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from('thoughts')
    .update({ body: parsed.data })
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
