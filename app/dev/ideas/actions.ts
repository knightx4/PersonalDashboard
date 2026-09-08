'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { fireFeatureRoutine, planRoutineId } from '@/lib/feedback/routine';
import { MODULE_IDS, MODULES } from '@/lib/modules';

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

/**
 * Hand an idea to Claude to be shaped into the plan.
 *
 * Not to be built. The session that wakes up reads the idea and the code and
 * writes a feature with its steps into the plan as *proposed* -- each with a
 * done-when and a size, waiting to be approved on the plan page. Nothing is
 * started until a person says so there. The same routine the notes queue
 * fires, with a different job in the extra turn.
 */
export async function shapeIdea(
  _prev: IdeaActionState,
  formData: FormData,
): Promise<IdeaActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing idea.' };

  const { data: idea } = await supabase
    .from('ideas')
    .select('id, body, module, plan_item_id')
    .eq('user_id', user.id)
    .eq('id', id.data)
    .maybeSingle();
  if (!idea) return { error: 'That idea no longer exists.' };
  if (idea.plan_item_id) return { error: 'This idea is already in the plan.' };

  const scope = idea.module as string | null;
  const label = scope ? (MODULES.find((m) => m.id === scope)?.label ?? scope) : 'the app as a whole';

  const text =
    `Shape idea ${String(idea.id).slice(0, 8)} into the plan, following the "Shaping an idea" ` +
    'section of .claude/skills/plan/SKILL.md. Write a proposal only: a feature with its steps, ' +
    'each with a done-when and a size, all in the proposed status and linked back to the idea. ' +
    'Do not build anything and do not approve anything.\n\n' +
    `Idea ${String(idea.id)} (about ${label}):\n\n${String(idea.body)}\n`;

  const result = await fireFeatureRoutine({
    apiKey: process.env.CLAUDE_API_KEY ?? null,
    routineId: planRoutineId(),
    text,
  });
  if (!result.ok) return { error: result.error };

  revalidatePath('/dev/ideas');
  return { message: 'Sent. A proposal will appear on the plan page when the session is done.' };
}
