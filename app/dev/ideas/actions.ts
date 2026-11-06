'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/auth/server';
import { requireOwner } from '@/lib/dev/owner';
import { insertIdea } from '@/lib/ideas/insert';
import { editIdea } from '@/lib/ideas/edit';
import { MODULE_IDS } from '@/lib/modules';
import { shapeIdeaRun } from '@/lib/ideas/shape';

export type IdeaActionState = {
  error?: string;
  message?: string;
  /** The idea just saved, so the panel can ask for its triage (plan #1179). */
  filed?: { table: 'ideas'; id: string };
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

// latency: pending
export async function addIdea(
  _prev: IdeaActionState,
  formData: FormData,
): Promise<IdeaActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const body = bodySchema.safeParse(formData.get('body') ?? '');
  const scope = moduleSchema.safeParse(String(formData.get('module') ?? ''));
  if (!body.success) return { error: body.error.issues[0].message };
  if (!scope.success) return { error: scope.error.issues[0].message };

  const { id, error } = await insertIdea(supabase, { userId: user.id, body: body.data, module: scope.data });
  if (error) return { error };

  revalidatePath('/dev/ideas');
  return {
    message: 'Idea saved.',
    filed: id ? { table: 'ideas', id } : undefined,
  };
}

/**
 * The same, from the header panel, wherever you were standing.
 *
 * A separate action rather than a third `kind` on `submitFeedback`, because
 * an idea is a different row in a different table with a different reason to
 * exist: the notes queue is worked, and an idea is a thing that might be worth
 * doing one day. Folding them into one writer would be the first step towards
 * a queue that quietly contains both.
 *
 * The page path comes over so the panel can propose the workspace the person
 * was in; the module that is actually filed is whatever the select says, which
 * may be neither.
 *
 * The owner check is here as well as in `addIdea`, and it is first. This is
 * the one action in this file the header panel calls, so it is reachable from
 * every page in the app rather than only from /dev. Filing a *note* is what
 * stays open to every account (#417); an idea is not a note, it is a row on
 * the dev workspace's own list. The panel's submit code went with note
 * 7c1f7238.
 */
// latency: pending
export async function submitIdea(
  _prev: IdeaActionState,
  formData: FormData,
): Promise<IdeaActionState> {
  await requireOwner();
  const saved = await addIdea(_prev, formData);

  // "Send and shape" (note beadca47): the same save, then the same hand-off the
  // Shape button on the ideas page makes, so an idea you already know you want
  // shaped does not need a second trip to that page to send it.
  if (formData.get('then') !== 'shape' || saved.error || !saved.filed) return saved;
  const shape = new FormData();
  shape.set('id', saved.filed.id);
  const shaped = await shapeIdea({}, shape);
  if (shaped.error) {
    return { ...saved, message: undefined, error: `Idea saved, but not sent: ${shaped.error}` };
  }
  return {
    ...saved,
    message:
      'Idea saved and sent. A proposal will appear on the plan page when the session is done.',
  };
}

/**
 * Rewriting one, because an idea captured in a hurry is usually half of the
 * thought and the other half turns up later.
 */
// latency: pending
export async function updateIdea(
  _prev: IdeaActionState,
  formData: FormData,
): Promise<IdeaActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = z.string().uuid().safeParse(formData.get('id'));
  const body = bodySchema.safeParse(formData.get('body') ?? '');
  const scope = moduleSchema.safeParse(String(formData.get('module') ?? ''));
  if (!id.success) return { error: 'Missing idea.' };
  if (!body.success) return { error: body.error.issues[0].message };
  if (!scope.success) return { error: scope.error.issues[0].message };

  const edited = await editIdea(supabase, { userId: user.id, id: id.data, body: body.data, module: scope.data });
  if ('error' in edited) return { error: edited.error };

  revalidatePath('/dev/ideas');
  return { message: 'Saved.' };
}

/**
 * Putting one aside. Dismissing rather than deleting, because the reason for
 * saying no to an idea is usually that it is not now: the row goes out of the
 * list and into the dismissed section, where you can bring it back.
 *
 * It is also what stops a suggestion coming round again. A session reads the
 * live ideas, so one you have put aside is not there to be suggested, shaped
 * or counted.
 */
// latency: pending
export async function dismissIdea(
  _prev: IdeaActionState,
  formData: FormData,
): Promise<IdeaActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing idea.' };

  const { error } = await supabase
    .from('ideas')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/dev/ideas');
  return { message: 'Dismissed.' };
}

/** The way back, for an idea whose time has come after all. */
// latency: pending
export async function restoreIdea(
  _prev: IdeaActionState,
  formData: FormData,
): Promise<IdeaActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing idea.' };

  const { error } = await supabase
    .from('ideas')
    .update({ dismissed_at: null })
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/dev/ideas');
  return { message: 'Back in the list.' };
}

// latency: pending
export async function deleteIdea(
  _prev: IdeaActionState,
  formData: FormData,
): Promise<IdeaActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

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

/**
 * Hand an idea to Claude to be shaped into the plan (lib/ideas/shape.ts).
 * A proposal only: nothing is built or approved.
 */
// latency: pending
export async function shapeIdea(
  _prev: IdeaActionState,
  formData: FormData,
): Promise<IdeaActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing idea.' };

  const result = await shapeIdeaRun(supabase, user.id, id.data);
  if (!result.ok) return { error: result.error };

  revalidatePath('/dev/ideas');
  revalidatePath('/dev/modules/[id]', 'page');
  return { message: 'Sent. A proposal will appear on the plan page when the session is done.' };
}
