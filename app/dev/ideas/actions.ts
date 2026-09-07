'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { MODULE_IDS } from '@/lib/modules';

export type IdeaActionState = {
  error?: string;
  message?: string;
};

/**
 * The module an idea is about. Empty means the app as a whole, which is a real
 * answer and the default one -- "the whole thing should have a search box" is
 * not a shopping idea.
 */
const moduleSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value === '' || (MODULE_IDS as readonly string[]).includes(value), {
    message: 'That is not a workspace.',
  })
  .transform((value) => (value === '' ? null : value));

const bodySchema = z.string().trim().min(3, 'Write a sentence.').max(4000);

export async function addIdea(
  _prev: IdeaActionState,
  formData: FormData,
): Promise<IdeaActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const body = bodySchema.safeParse(formData.get('body') ?? '');
  const scope = moduleSchema.safeParse(String(formData.get('module') ?? ''));
  if (!body.success) return { error: body.error.issues[0].message };
  if (!scope.success) return { error: scope.error.issues[0].message };

  const { error } = await supabase.from('ideas').insert({
    user_id: user.id,
    body: body.data,
    module: scope.data,
  });
  if (error) return { error: error.message };

  revalidatePath('/dev/ideas');
  return { message: 'Idea saved.' };
}

/**
 * Rewriting one, because an idea captured in a hurry is usually half of the
 * thought and the other half turns up later.
 */
export async function updateIdea(
  _prev: IdeaActionState,
  formData: FormData,
): Promise<IdeaActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('id'));
  const body = bodySchema.safeParse(formData.get('body') ?? '');
  const scope = moduleSchema.safeParse(String(formData.get('module') ?? ''));
  if (!id.success) return { error: 'Missing idea.' };
  if (!body.success) return { error: body.error.issues[0].message };
  if (!scope.success) return { error: scope.error.issues[0].message };

  const { error } = await supabase
    .from('ideas')
    .update({ body: body.data, module: scope.data })
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/dev/ideas');
  return { message: 'Saved.' };
}

export async function deleteIdea(
  _prev: IdeaActionState,
  formData: FormData,
): Promise<IdeaActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing idea.' };

  const { error } = await supabase
    .from('ideas')
    .delete()
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/dev/ideas');
  return { message: 'Deleted.' };
}
