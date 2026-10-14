'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { recordSessionSpend } from '@/lib/core/spend/session';
import type { PrepNote } from '@/lib/jobs/interview/prep-payload';
import { prepareRound } from '@/lib/jobs/interview/prepare-round';

/* -------------------------------------------------------------------------- */
/* The prep note                                                              */
/* -------------------------------------------------------------------------- */

const prepNoteSchema = z.object({
  interviewId: z.string().uuid(),
  /** An explicit press of Regenerate. Without it a current note is left alone. */
  regenerate: z.boolean().optional(),
});

/**
 * Write the prep note for the round one conversation belongs to.
 *
 * Modelled on matchRoleRequirements above, and the same refusals apply for the
 * same reasons: no key in the environment, an interview that is not yours, and
 * nothing to ground on. That last one matters most — a note written with no
 * description and an empty bank is a note about interviews in general, and it
 * would read exactly like one written from a full posting.
 *
 * The note belongs to the round rather than to the conversation the button was
 * pressed on, per the decision on #64. It is stored on the round's earliest
 * conversation and every conversation in the round reads that one, which is
 * what a superday needs: one note about the day, not four about its quarters.
 *
 * A second press is free. The key fingerprints what the note was written
 * against, so pressing again returns the stored note untouched until one of
 * those facts changes or the person explicitly regenerates. Without that, a
 * button on a page anybody visits twice is a model call anybody pays for
 * twice.
 */
// latency: pending
export async function writeRoundPrepNote(
  input: z.input<typeof prepNoteSchema>,
): Promise<{ note: PrepNote | null; error: string | null }> {
  const parsed = prepNoteSchema.safeParse(input);
  if (!parsed.success) return { note: null, error: parsed.error.issues[0].message };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { note: null, error: 'Prep is not configured.' };

  const user = await requireUser();
  const supabase = await createClient();

  const result = await prepareRound(supabase as unknown as AppSupabaseClient, {
    userId: user.id,
    interviewId: parsed.data.interviewId,
    regenerate: parsed.data.regenerate,
    apiKey,
  });
  await recordSessionSpend(user.id, { module: 'jobs', operation: 'write-interview-prep' }, result.spend);
  if (result.error) return { note: null, error: result.error };

  if (result.spent) {
    revalidatePath(`/jobs/roles/${result.roleId}`);
    revalidatePath('/jobs/interviews');
    revalidatePath('/jobs');
  }
  return { note: result.note, error: null };
}
