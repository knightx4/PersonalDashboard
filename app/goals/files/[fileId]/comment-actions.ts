'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { COMMENT_MAX } from '@/lib/goals/comments';
import { createCoreClient } from '@/lib/core/auth/server';
import { fileHref } from '@/lib/files/files';
import { deleteFileComment, loadFile, writeFileComment } from '@/lib/files/store';

/**
 * Writing and removing a comment on a file (note 7a6a37aa), in
 * core.conversations under the file's ref (plan #1470). The same form the goal thread posts:
 * `id` is the file, `body` the words. Nothing answers here; the goals run
 * reads the thread before it revises the file.
 */

export type FileCommentState = { error?: string; message?: string };

const Id = z.string().uuid();
const Body = z.string().trim().min(1, 'Write something.').max(COMMENT_MAX);

// latency: optimistic -- the thread draws the comment at once, the write returns by revalidation
export async function addFileComment(
  _prev: FileCommentState,
  form: FormData,
): Promise<FileCommentState> {
  const user = await requireUser();
  const id = Id.safeParse(form.get('id'));
  const body = Body.safeParse(form.get('body') ?? '');
  if (!id.success) return { error: 'Could not tell which file the comment is on.' };
  if (!body.success) return { error: body.error.issues[0].message };

  const core = await createCoreClient();
  if (!(await loadFile(core, id.data))) return { error: 'That file is no longer here.' };
  try {
    await writeFileComment(core, { userId: user.id, fileId: id.data, body: body.data });
  } catch {
    return { error: 'The comment could not be saved. Try again.' };
  }
  revalidatePath(fileHref(id.data));
  return { message: 'Saved.' };
}

// latency: pending
export async function deleteFileCommentAction(
  _prev: FileCommentState,
  form: FormData,
): Promise<FileCommentState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which comment that was.' };
  try {
    if (!(await deleteFileComment(await createCoreClient(), id.data))) {
      return { error: 'That comment is already gone.' };
    }
  } catch {
    return { error: 'The comment could not be deleted. Try again.' };
  }
  revalidatePath('/goals/files', 'layout');
  return { message: 'Deleted.' };
}
