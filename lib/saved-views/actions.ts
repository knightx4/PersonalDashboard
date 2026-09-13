'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { deleteView, renameView, saveView, setDefaultView } from '@/lib/saved-views/store';

/**
 * Saving, renaming, deleting and defaulting an arrangement.
 *
 * One set of actions for every list, because a view is the same thing on all
 * of them: a name and the query string the list was showing. The list is its
 * pathname, sent by the control that called this and checked here rather than
 * trusted -- it decides both which views a page sees and where reopening one
 * goes.
 */

export type ViewState = { error?: string };

/** A pathname of ours, and nothing that could send somebody elsewhere. */
const ListPath = z
  .string()
  .trim()
  .regex(/^\/[A-Za-z0-9/_-]*$/, 'That is not a list in this app.')
  .max(200);

const SaveInput = z.object({
  list: ListPath,
  name: z.string().trim().min(1, 'Give the view a name.').max(60),
  query: z.string().trim().max(2000),
});

const ViewInput = z.object({ list: ListPath, id: z.string().uuid() });

export async function saveCurrentView(_prev: ViewState, formData: FormData): Promise<ViewState> {
  const user = await requireUser();

  const parsed = SaveInput.safeParse({
    list: formData.get('list') ?? '',
    name: formData.get('name') ?? '',
    query: formData.get('query') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Could not save that view.' };
  }

  try {
    const supabase = await createCoreClient();
    await saveView(supabase, user.id, parsed.data);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not save that view.' };
  }

  revalidatePath(parsed.data.list);
  return {};
}

export async function renameSavedView(_prev: ViewState, formData: FormData): Promise<ViewState> {
  await requireUser();

  const parsed = SaveInput.omit({ query: true })
    .extend(ViewInput.shape)
    .safeParse({
      list: formData.get('list') ?? '',
      id: formData.get('id') ?? '',
      name: formData.get('name') ?? '',
    });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Could not rename that view.' };
  }

  try {
    const supabase = await createCoreClient();
    await renameView(supabase, parsed.data.id, parsed.data.name);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not rename that view.' };
  }

  revalidatePath(parsed.data.list);
  return {};
}

export async function deleteSavedView(_prev: ViewState, formData: FormData): Promise<ViewState> {
  await requireUser();

  const parsed = ViewInput.safeParse({
    list: formData.get('list') ?? '',
    id: formData.get('id') ?? '',
  });
  if (!parsed.success) return { error: 'Could not work out which view that was.' };

  try {
    const supabase = await createCoreClient();
    await deleteView(supabase, parsed.data.id);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not delete that view.' };
  }

  revalidatePath(parsed.data.list);
  return {};
}

/** Make one view the one this list opens on, or take the mark off it. */
export async function defaultSavedView(_prev: ViewState, formData: FormData): Promise<ViewState> {
  await requireUser();

  const parsed = ViewInput.safeParse({
    list: formData.get('list') ?? '',
    id: formData.get('id') ?? '',
  });
  if (!parsed.success) return { error: 'Could not work out which view that was.' };

  const clearing = formData.get('clear') === '1';

  try {
    const supabase = await createCoreClient();
    await setDefaultView(supabase, parsed.data.list, clearing ? null : parsed.data.id);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not set the default.' };
  }

  revalidatePath(parsed.data.list);
  return {};
}
