'use server';

import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { recordTrackOffer, themeName, themeStrength } from '@/lib/learn/flow/offer';
import { createVaultClient } from '@/lib/vault/auth/server';

/**
 * The answers to a new track offered on Learn (plan #778): Not now, Never,
 * and the toast's Undo (`components/learn/track-offers.tsx`).
 *
 * Practice Flow's own questions are asked about levels of topics
 * (./practice.tsx); the claims-graph questions written ahead that this file
 * used to ask and answer were retired by plan #2313.2.
 */

const OfferAnswer = z.object({
  themeId: z.string().uuid(),
  outcome: z.enum(['not_now', 'never']),
});

/**
 * Not now or Never, on a new track the flow offered (plan #778).
 *
 * Not now holds the theme back for a few weeks; Never stops it being offered
 * again. Both are kept in `learn.track_offers`, which is also what plan #780
 * reads to learn which offers you take up. Nothing is revalidated: the card
 * hides itself, and refreshing the flow would run the page again and take a
 * new question off the queue.
 *
 * The theme is read back through the session's own client for its name, so an
 * id from the form that is not one of your themes records nothing.
 */
// latency: optimistic
export async function answerTrackOffer(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = OfferAnswer.safeParse({
    themeId: formData.get('themeId'),
    outcome: formData.get('outcome'),
  });
  if (!parsed.success) return;

  const [supabase, vault] = await Promise.all([createLearnClient(), createVaultClient()]);
  const [name, strength] = await Promise.all([
    themeName(vault, parsed.data.themeId),
    themeStrength(vault, parsed.data.themeId),
  ]);
  if (!name) return;

  await recordTrackOffer(supabase, user.id, {
    themeId: parsed.data.themeId,
    themeName: name,
    themeStrength: strength,
    outcome: parsed.data.outcome,
  });
}

const OfferPress = z.union([
  z.object({ themeId: z.string().uuid() }),
  z.object({ subjectId: z.string().uuid() }),
]);

/**
 * The toast's Undo on Later, Decline or Drop of an offered track (plan
 * #1957.3): the newest answer on that theme, or on that resting subject, is
 * taken back, so the offer can come again as if it had not been answered.
 */
// latency: pending
export async function takeBackOfferAnswer(
  input: { themeId: string } | { subjectId: string },
): Promise<void> {
  const user = await requireUser();
  const parsed = OfferPress.safeParse(input);
  if (!parsed.success) return;
  const supabase = await createLearnClient();
  let query = supabase.from('track_offers').select('id').eq('user_id', user.id);
  query =
    'themeId' in parsed.data
      ? query.eq('theme_id', parsed.data.themeId)
      : query.eq('subject_id', parsed.data.subjectId).eq('kind', 'resting');
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  const id = data?.[0]?.id as string | undefined;
  if (!id) return;
  const { error: deleteError } = await supabase
    .from('track_offers')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (deleteError) throw new Error(deleteError.message);
}
