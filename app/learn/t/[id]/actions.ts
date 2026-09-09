'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import {
  addManualReading,
  deleteReading,
  deleteTrack,
  savePlan,
  type PlanSaveRow,
} from '@/lib/learn/tracks/save';
import { planTopic } from '@/lib/learn/import/plan-topic';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { planStepSchema, type PlanStep } from '@/lib/learn/import/plan-payload';
import { loadTrack } from '@/lib/learn/tracks/load';

/**
 * Adding to a track by hand, and taking things off it.
 *
 * Every write goes through the session client, so RLS decides which rows are
 * touched. The ids come from the form and are not trusted for ownership: the
 * insert carries the user id from the session, and a row belonging to somebody
 * else fails the policy rather than being filtered out here.
 *
 * The two removals take a plain FormData because ConfirmStep calls them
 * directly rather than through useActionState. They are genuinely destructive
 * and there is no undo, which is exactly the case that component exists for --
 * a second click in the same place with the consequence written beside it.
 */

export type TrackActionState = { error?: string };

const AddInput = z.object({
  trackId: z.string().uuid(),
  title: z
    .string()
    .trim()
    .min(1, 'Write down what you want to learn.')
    .max(500, 'That is too long — put the detail in the note instead.'),
  why: z.string().trim().max(500),
});

export async function addToTrack(
  _prev: TrackActionState,
  formData: FormData,
): Promise<TrackActionState> {
  const user = await requireUser();

  const parsed = AddInput.safeParse({
    trackId: formData.get('trackId'),
    title: formData.get('title') ?? '',
    why: formData.get('why') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Could not add that.' };
  }

  const supabase = await createLearnClient();
  try {
    await addManualReading(supabase, user.id, {
      trackId: parsed.data.trackId,
      title: parsed.data.title,
      why: parsed.data.why || null,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not add that.' };
  }

  revalidatePath(`/learn/t/${parsed.data.trackId}`);
  revalidatePath('/learn');
  return {};
}

const RemoveInput = z.object({
  readingId: z.string().uuid(),
  trackId: z.string().uuid(),
});

/**
 * Take one reading off a track.
 *
 * Throws rather than returning an error, because ConfirmStep renders what a
 * rejected promise says and a message returned quietly would leave the button
 * looking like it worked.
 */
export async function removeFromTrack(formData: FormData): Promise<void> {
  await requireUser();

  const parsed = RemoveInput.safeParse({
    readingId: formData.get('readingId'),
    trackId: formData.get('trackId'),
  });
  if (!parsed.success) throw new Error('Could not work out what to remove.');

  const supabase = await createLearnClient();
  await deleteReading(supabase, parsed.data.readingId);

  revalidatePath(`/learn/t/${parsed.data.trackId}`);
  revalidatePath('/learn');
}

/**
 * Delete a whole track.
 *
 * Its readings and its import go with it, on the foreign keys. The sources do
 * not: they are shared across tracks, and deleting one track must not take a
 * work another track still points at.
 */
export async function removeTrack(formData: FormData): Promise<void> {
  await requireUser();

  const trackId = z.string().uuid().safeParse(formData.get('trackId'));
  if (!trackId.success) throw new Error('Could not work out which track to delete.');

  const supabase = await createLearnClient();
  await deleteTrack(supabase, trackId.data);

  revalidatePath('/learn');
  redirect('/learn');
}

export type PlanState = {
  error?: string;
  /** Proposed, not saved. Nothing reaches the track until you confirm. */
  steps?: PlanStep[];
};

/**
 * Plan a topic that has nothing in it.
 *
 * Proposes and writes nothing, the same rule the import path follows. It
 * matters most here: this is the one call in the module given nothing but a
 * topic, so it has the most room to be wrong, and a generated plan saved
 * without a look is a queue of things somebody else decided you should read.
 */
export async function planTrack(_prev: PlanState, formData: FormData): Promise<PlanState> {
  const user = await requireUser();

  const trackId = z.string().uuid().safeParse(formData.get('trackId'));
  if (!trackId.success) return { error: 'Could not work out which topic to plan.' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Planning a topic needs ANTHROPIC_API_KEY to be set.' };

  const supabase = await createLearnClient();
  const track = await loadTrack(supabase, trackId.data);
  if (!track) return { error: 'That topic is not there any more.' };

  const spend = collectSpend();
  const result = await planTopic({
    topic: track.title,
    question: track.question,
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(user.id, 'plan-topic', spend.reports);

  if (!result.ok) return { error: result.detail };
  return { steps: result.steps };
}

/**
 * Write the steps you kept.
 *
 * The payloads ride back through hidden fields, so they are re-validated here
 * rather than trusted -- a form field is user input whoever wrote the form --
 * and a row that does not survive validation is dropped rather than saved
 * half-formed.
 */
export async function confirmPlan(
  _prev: TrackActionState,
  formData: FormData,
): Promise<TrackActionState> {
  const user = await requireUser();

  const trackId = z.string().uuid().safeParse(formData.get('trackId'));
  if (!trackId.success) return { error: 'Could not work out which topic to save to.' };

  const rows: PlanSaveRow[] = [];
  for (const raw of formData.getAll('step')) {
    if (typeof raw !== 'string') continue;
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      continue;
    }
    const shape = planStepSchema.safeParse(payload);
    if (!shape.success) continue;
    rows.push({
      subject: shape.data.subject,
      why: shape.data.why ?? null,
      resolved: shape.data.source ?? null,
    });
  }

  if (rows.length === 0) return { error: 'Tick at least one step to save.' };

  const supabase = await createLearnClient();
  try {
    await savePlan(supabase, user.id, { trackId: trackId.data, rows });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not save that plan.' };
  }

  revalidatePath(`/learn/t/${trackId.data}`);
  revalidatePath('/learn');
  return {};
}
