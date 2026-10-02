'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import { createClient } from '@/lib/auth/server';
import { recordSpend } from '@/lib/core/spend/record';
import { claimInspirationCheck, inspirationCheckSteps, runInspirationCheck } from '@/lib/dev/inspiration/check';
import { requireOwner } from '@/lib/dev/owner';
import { parsePlaylistInput } from '@/lib/learn/providers/youtube';

/**
 * The Inspiration tab's writes (plan #1412). Each one refuses anybody but the
 * owner in its own right, since an action can be posted without the Dev
 * layout ever rendering (#417), and ends by revalidating the page.
 */

export type InspirationActionState = { error?: string; message?: string };

const INSPIRATION_PATH = '/dev/inspiration';

/**
 * Point the tab at another playlist.
 *
 * Takes a link or a bare id. The read time and any error belong to the old
 * playlist, so both are cleared; the videos already read stay, and the next
 * read marks the ones not on the new playlist as taken off.
 */
// latency: pending
export async function setInspirationPlaylist(
  _prev: InspirationActionState,
  formData: FormData,
): Promise<InspirationActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const parsed = parsePlaylistInput(String(formData.get('playlist') ?? ''));
  if (!parsed.ok) return { error: parsed.error };

  const { error } = await supabase.from('inspiration_settings').upsert(
    {
      user_id: user.id,
      youtube_playlist_id: parsed.playlistId,
      playlist_read_at: null,
      playlist_error: null,
    },
    { onConflict: 'user_id' },
  );
  if (error) return { error: error.message };

  revalidatePath(INSPIRATION_PATH);
  return { message: 'Playlist saved.' };
}

/** How long the check after the response may take, inside the page's maxDuration of 300 seconds. */
const CHECK_BUDGET_MS = 270_000;

/**
 * Check now (plan #1411): the daily check, for the owner, at once.
 *
 * Reading twelve new videos takes longer than a request should wait, so this
 * takes the check's claim, answers, and does the work after the response
 * (next/server `after`) inside the page's five minutes. The claim is what the
 * tab reads to say a check is going, and what stops a second press or the
 * daily run from reading the same videos at the same time. Whatever does not
 * fit in the five minutes is picked up by the next check.
 */
// latency: pending -- starts a check that runs after the response, and returns
export async function checkInspirationNow(): Promise<InspirationActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const settings = await supabase
    .from('inspiration_settings')
    .select('youtube_playlist_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (settings.error) return { error: settings.error.message };
  if (!settings.data?.youtube_playlist_id) return { error: 'Set a playlist first.' };

  const learn = createLearnServiceSupabase();
  const startedAt = new Date();
  if (!(await claimInspirationCheck(learn, user.id, startedAt))) {
    return { message: 'A check is already going.' };
  }

  const core = createCoreServiceSupabase();
  const steps = inspirationCheckSteps(
    learn,
    {
      trigger: 'press',
      anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || null,
      deadline: startedAt.getTime() + CHECK_BUDGET_MS,
      onSpend: (userId, report, operation) =>
        void spend.push(recordSpend(core, userId, { module: 'core', operation, model: report.model, usage: report.usage })),
    },
    true,
  );
  const spend: Promise<unknown>[] = [];

  after(async () => {
    try {
      const result = await runInspirationCheck(steps, user.id, startedAt);
      if (result.ran && result.error) console.error('[inspiration check]', result.error);
    } catch (error) {
      console.error('[inspiration check]', error instanceof Error ? error.message : error);
    }
    await Promise.all(spend);
  });

  revalidatePath(INSPIRATION_PATH);
  return { message: 'Checking the playlist. New takeaways show here as Dash reads them.' };
}
