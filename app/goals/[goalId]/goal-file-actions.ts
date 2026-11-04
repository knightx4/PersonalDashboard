'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { DOCUMENT_MAX_BYTES, documentContentType, ownsDocumentPath } from '@/lib/goals/extract';
import { uploadPlace, uploadTitle } from '@/lib/goals/goal-files-tab';
import {
  addGoalUpload,
  loadGoalSteps,
  loadWaitingKinds,
  removeFileFromGoal,
  renameFile,
  setFilePinned,
} from '@/lib/goals/goal-files-tab-store';

/**
 * The Work & files tab's writes (plan #2778.7): keep a file you dropped on
 * the goal, and a file's menu (Pin, Rename, Remove). The browser has already
 * put an upload in your folder of the goals-documents bucket, as the form's
 * reader does (fill-from-document.tsx), so the file never passes through
 * this action's one-megabyte body.
 */

export type GoalFileState = { error?: string; placed?: string };

const Upload = z.object({
  goalId: z.string().uuid(),
  path: z.string().min(1).max(400),
  name: z.string().min(1).max(300),
  size: z.number().int().min(0).max(DOCUMENT_MAX_BYTES),
  /** Pressed Add on a row under Waiting for: the kind it fills. */
  kindId: z.string().uuid().nullable().optional(),
});

// latency: pending
export async function addGoalFileAction(raw: z.input<typeof Upload>): Promise<GoalFileState> {
  const user = await requireUser();
  const parsed = Upload.safeParse(raw);
  if (!parsed.success) return { error: 'Could not tell which file that was.' };
  const input = parsed.data;
  if (!ownsDocumentPath(user.id, input.path)) return { error: 'Could not find that file.' };
  const contentType = documentContentType(input.name);
  if (!contentType) return { error: 'That kind of file cannot be kept. Use a PDF, an image, a Word file or text.' };

  const [goals, core] = await Promise.all([createGoalsClient(), createCoreClient()]);
  const steps = await loadGoalSteps(goals, input.goalId);
  if (!steps) return { error: 'That goal is gone. Reload to see.' };
  const waiting = await loadWaitingKinds(goals, steps).catch(() => []);
  const open = steps.filter((step) => step.status !== 'done' && step.status !== 'dropped');
  const place = uploadPlace(input.name, waiting, open, input.kindId);
  await addGoalUpload(core, goals, user.id, {
    itemId: place.stepId ?? input.goalId,
    title: uploadTitle(input.name),
    path: input.path,
    contentType,
    sizeBytes: input.size,
    kindId: place.kindId,
  });
  revalidatePath(`/goals/${input.goalId}`);
  const step = place.stepId ? steps.find((s) => s.id === place.stepId) : null;
  return { placed: step ? `Added to “${step.title}”.` : 'Added to the goal.' };
}

const FileOnGoal = z.object({ goalId: z.string().uuid(), fileId: z.string().uuid() });

// latency: pending
export async function pinGoalFileAction(form: FormData): Promise<GoalFileState> {
  await requireUser();
  const parsed = FileOnGoal.extend({ pinned: z.enum(['true', 'false']) }).safeParse({
    goalId: form.get('goalId'),
    fileId: form.get('fileId'),
    pinned: form.get('pinned'),
  });
  if (!parsed.success) return { error: 'Could not tell which file that was.' };
  const core = await createCoreClient();
  const done = await setFilePinned(core, parsed.data.fileId, parsed.data.pinned === 'true');
  if (!done) return { error: 'That file is gone. Reload to see.' };
  revalidatePath(`/goals/${parsed.data.goalId}`);
  return {};
}

// latency: pending
export async function renameGoalFileAction(form: FormData): Promise<GoalFileState> {
  await requireUser();
  const parsed = FileOnGoal.extend({ title: z.string().trim().min(1).max(200) }).safeParse({
    goalId: form.get('goalId'),
    fileId: form.get('fileId'),
    title: form.get('title'),
  });
  if (!parsed.success) return { error: 'A name of up to 200 characters, please.' };
  const core = await createCoreClient();
  const done = await renameFile(core, parsed.data.fileId, parsed.data.title);
  if (!done) return { error: 'That file is gone. Reload to see.' };
  revalidatePath(`/goals/${parsed.data.goalId}`);
  return {};
}

// latency: pending
export async function removeGoalFileAction(form: FormData): Promise<GoalFileState> {
  await requireUser();
  const parsed = FileOnGoal.safeParse({ goalId: form.get('goalId'), fileId: form.get('fileId') });
  if (!parsed.success) return { error: 'Could not tell which file that was.' };
  const goals = await createGoalsClient();
  const steps = await loadGoalSteps(goals, parsed.data.goalId);
  if (!steps) return { error: 'That goal is gone. Reload to see.' };
  await removeFileFromGoal(goals, parsed.data.fileId, [parsed.data.goalId, ...steps.map((s) => s.id)]);
  revalidatePath(`/goals/${parsed.data.goalId}`);
  return {};
}
