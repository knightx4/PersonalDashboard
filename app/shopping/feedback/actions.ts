'use server';

import { timingSafeEqual } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';

export type FeedbackActionState = {
  error?: string;
  message?: string;
};

/**
 * Shared submit code. Overridable with FEEDBACK_CODE so the value can live in
 * the environment rather than the repository; the fallback keeps the button
 * working out of the box.
 */
function expectedCode(): string {
  return process.env.FEEDBACK_CODE ?? '1612*';
}

/** Constant-time compare so the check cannot be probed character by character. */
function codeMatches(given: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expectedCode());
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const submitSchema = z.object({
  kind: z.enum(['bug', 'feature']),
  body: z.string().trim().min(3).max(4000),
  pagePath: z.string().max(300).nullable(),
});

export async function submitFeedback(
  _prev: FeedbackActionState,
  formData: FormData,
): Promise<FeedbackActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  if (!codeMatches(String(formData.get('code') ?? ''))) {
    return { error: 'That code is not right.' };
  }

  const parsed = submitSchema.safeParse({
    kind: String(formData.get('kind') ?? 'feature'),
    body: String(formData.get('body') ?? ''),
    pagePath: String(formData.get('page_path') ?? '') || null,
  });
  if (!parsed.success) {
    return { error: 'Write a sentence or two describing it.' };
  }

  const { error } = await supabase.from('feedback_items').insert({
    user_id: user.id,
    kind: parsed.data.kind,
    body: parsed.data.body,
    page_path: parsed.data.pagePath,
    user_agent: String(formData.get('user_agent') ?? '').slice(0, 500) || null,
  });
  if (error) return { error: error.message };

  revalidatePath('/shopping/feedback');
  return {
    message:
      parsed.data.kind === 'bug' ? 'Bug report saved.' : 'Feature request saved.',
  };
}

const statusSchema = z.enum([
  'open',
  'in_progress',
  'blocked',
  'planned',
  'done',
  'declined',
]);

/** Triage from the list page. */
export async function updateFeedbackStatus(
  _prev: FeedbackActionState,
  formData: FormData,
): Promise<FeedbackActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('id'));
  const status = statusSchema.safeParse(formData.get('status'));
  if (!id.success || !status.success) return { error: 'Missing item or status.' };

  const { error } = await supabase
    .from('feedback_items')
    .update({
      status: status.data,
      completed_at:
        status.data === 'done' || status.data === 'declined'
          ? new Date().toISOString()
          : null,
    })
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/shopping/feedback');
  return { message: 'Updated.' };
}

export async function deleteFeedback(
  _prev: FeedbackActionState,
  formData: FormData,
): Promise<FeedbackActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing item.' };

  const { error } = await supabase
    .from('feedback_items')
    .delete()
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/shopping/feedback');
  return { message: 'Deleted.' };
}


/** Reorder the queue by hand: 1 next, 2 normal, 3 someday. */
export async function setFeedbackPriority(
  _prev: FeedbackActionState,
  formData: FormData,
): Promise<FeedbackActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('id'));
  const priority = z.coerce.number().int().min(1).max(3).safeParse(formData.get('priority'));
  if (!id.success || !priority.success) return { error: 'Missing item or priority.' };

  const { error } = await supabase
    .from('feedback_items')
    .update({ priority: priority.data })
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/shopping/feedback');
  return { message: 'Priority updated.' };
}
