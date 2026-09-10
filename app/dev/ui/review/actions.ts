'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { fireFeatureRoutine, reviewRoutine } from '@/lib/feedback/routine';
import { isUiScope, type UiScope } from '@/lib/ui-review/scope';

export type UiReviewActionState = {
  error?: string;
  message?: string;
};

const idSchema = z.string().uuid();
const scopeSchema = z.string().refine(isUiScope, 'That is not a module.');
const decisionSchema = z.enum(['open', 'confirmed', 'dismissed']);

/** The pass a session is asked to run, and where the procedure lives. */
function reviewText(scope: UiScope): string {
  return (
    `Review the ${scope === 'shared' ? 'shared' : scope} module's interface, following ` +
    '.claude/skills/ui-review/SKILL.md. Read that first: it says which files to read, which ' +
    'shots to look at, what a finding has to carry, and what a pass must not do.\n\n' +
    `Run \`npm run check:ui -- --module ${scope}\` for the mechanical count, shoot that ` +
    "module's surfaces from /preview, and hold each one against the laws in app/dev/ui/laws.ts. " +
    'File what is out of line as findings under one ui_reviews row for this module, each with ' +
    'the file, the line where there is one, the law and the surface it was seen on. Fix nothing ' +
    'while reviewing.'
  );
}

/**
 * Start a pass on one module.
 *
 * The decision this follows is that a session proposes and you confirm: it
 * files candidates against the module, and each one is confirmed or dismissed
 * here, next to the surface it came from. So this fires the session and does
 * nothing else -- in particular it does not record a review, because a pass
 * that never ran must not leave a row saying the module was looked at.
 *
 * Its own routine id, with no fallback to the shared one. A button pointed at
 * the notes or plan routine would not fail; it would work the wrong queue, so
 * an unset id is an error said out loud rather than a review that quietly
 * became something else.
 */
// latency: pending
export async function startUiReview(
  _prev: UiReviewActionState,
  formData: FormData,
): Promise<UiReviewActionState> {
  await requireUser();

  const scope = scopeSchema.safeParse(formData.get('module'));
  if (!scope.success) return { error: 'Missing module.' };

  const routine = reviewRoutine();
  if (!routine.id) {
    return {
      error:
        'No review routine on this deployment, so nothing was started. Set ' +
        'CLAUDE_REVIEW_ROUTINE_ID to the routine that runs the UI review, and ' +
        'CLAUDE_REVIEW_ROUTINE_TOKEN to its token.',
    };
  }

  const result = await fireFeatureRoutine({
    apiKey: routine.token,
    routineId: routine.id,
    text: reviewText(scope.data as UiScope),
  });
  if (!result.ok) return { error: result.error };

  return { message: `Reviewing ${scope.data}. ${result.detail}` };
}

/**
 * Confirm a finding, or dismiss it.
 *
 * A dismissal is kept rather than deleted: what a pass proposed and you turned
 * down is the record that stops the next pass filing the same nit. Putting one
 * back is the same write with 'open', which clears the decision date.
 */
// latency: pending
export async function decideUiFinding(
  _prev: UiReviewActionState,
  formData: FormData,
): Promise<UiReviewActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = idSchema.safeParse(formData.get('id'));
  const decision = decisionSchema.safeParse(formData.get('decision'));
  if (!id.success) return { error: 'Missing finding.' };
  if (!decision.success) return { error: 'Missing decision.' };

  const note = String(formData.get('note') ?? '').trim();

  const { error } = await supabase
    .from('ui_findings')
    .update({
      status: decision.data,
      decided_at: decision.data === 'open' ? null : new Date().toISOString(),
      ...(note ? { note } : {}),
    })
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/dev/ui/review');
  return {
    message:
      decision.data === 'confirmed'
        ? 'Confirmed.'
        : decision.data === 'dismissed'
          ? 'Dismissed.'
          : 'Back on the list.',
  };
}
