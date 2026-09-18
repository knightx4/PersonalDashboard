'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/auth/server';
import { requireOwner } from '@/lib/dev/owner';
import { threadText } from '@/lib/comments/context';
import { codeMatches } from '@/lib/feedback/code';
import { planRoutine } from '@/lib/feedback/routine';
import { IDEA_COLUMNS, ideaRowFrom } from '@/lib/ideas/load';
import { FOG_RULE, PLAIN_ENGLISH_RULE } from '@/lib/plan/brief';
import { MODULE_IDS, MODULES } from '@/lib/modules';
import { startRoutineRun } from '@/lib/plan/runs';

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
 * The same, from the header panel, wherever you were standing.
 *
 * A separate action rather than a third `kind` on `submitFeedback`, because
 * an idea is a different row in a different table with a different reason to
 * exist: the notes queue is worked, and an idea is a thing that might be worth
 * doing one day. Folding them into one writer would be the first step towards
 * a queue that quietly contains both.
 *
 * What it does share is the panel's submit code, which is why that check now
 * lives in `lib/feedback/code.ts` rather than beside one of the two actions.
 *
 * The page path comes over so the panel can propose the workspace the person
 * was in; the module that is actually filed is whatever the select says, which
 * may be neither.
 *
 * The owner check is here as well as in `addIdea`, and it is first -- before
 * the submit code. This is the one action in this file the header panel calls,
 * so it is reachable from every page in the app rather than only from /dev, and
 * the check has to be the first thing it does or the answer it gives away is
 * whether the code was right. Filing a *note* is what stays open to every
 * account (#417); an idea is not a note, it is a row on the dev workspace's
 * own list.
 */
// latency: pending
export async function submitIdea(
  _prev: IdeaActionState,
  formData: FormData,
): Promise<IdeaActionState> {
  await requireOwner();

  if (!codeMatches(String(formData.get('code') ?? ''))) {
    return { error: 'That code is not right.' };
  }
  return addIdea(_prev, formData);
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

  const { error } = await supabase
    .from('ideas')
    .update({ body: body.data, module: scope.data })
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

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
 * Hand an idea to Claude to be shaped into the plan.
 *
 * Not to be built. The session that wakes up reads the idea and the code and
 * writes a feature with its steps into the plan as *proposed* -- each with a
 * done-when and a size, waiting to be approved on the plan page. Nothing is
 * started until a person says so there. The same routine the notes queue
 * fires, with a different job in the extra turn.
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

  // The whole row rather than the four columns the turn used to name, because
  // the thread comes with it. What was said underneath an idea is usually the
  // half that says what it actually means -- the first sentence is a note to
  // self, and the shape it should take was worked out in the replies.
  const { data } = await supabase
    .from('ideas')
    .select(IDEA_COLUMNS)
    .eq('user_id', user.id)
    .eq('id', id.data)
    .maybeSingle();
  if (!data) return { error: 'That idea no longer exists.' };
  const idea = ideaRowFrom(data as unknown as Record<string, unknown>);
  if (idea.planItem) return { error: 'This idea is already in the plan.' };

  const scope = idea.module;
  const label = scope ? (MODULES.find((m) => m.id === scope)?.label ?? scope) : 'the app as a whole';
  const said = threadText(idea.thread);

  const text =
    `Shape idea ${String(idea.id).slice(0, 8)} into the plan, following ` +
    '.claude/skills/plan/reference/shaping.md, and .claude/skills/plan/reference/writing.md for ' +
    'how every row is worded. Write a proposal only: a feature with its steps, ' +
    'each with a done-when and a size, all in the proposed status and linked back to the idea. ' +
    'Do not build anything and do not approve anything.\n\n' +
    `${PLAIN_ENGLISH_RULE}\n\n${FOG_RULE}\n\n` +
    `Idea ${idea.id} (about ${label}):\n\n${idea.body}\n` +
    (said ? `\n${said}` : '');

  const result = await startRoutineRun({
    supabase,
    userId: user.id,
    job: 'shape',
    routine: planRoutine(),
    // No step: the proposal the session writes is what will carry the number,
    // and it does not exist yet.
    text,
  });
  if (!result.ok) return { error: result.error };

  revalidatePath('/dev/ideas');
  return { message: 'Sent. A proposal will appear on the plan page when the session is done.' };
}
