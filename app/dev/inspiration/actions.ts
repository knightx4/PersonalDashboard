'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import { z } from 'zod';
import { shapeIdea } from '@/app/dev/ideas/actions';
import { createClient } from '@/lib/auth/server';
import { recordSpend } from '@/lib/core/spend/record';
import { craftTakeaway as fileTakeaway, matchedName } from '@/lib/dev/inspiration/craft';
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

/**
 * Craft into a plan (plan #1413): file the takeaway as an idea in the
 * workspace it touches, with its videos and moments, mark it crafted, and send
 * the idea to the shape routine through the ideas page's own action. The
 * proposed feature arrives when that session is done, and the row then reads
 * "In the plan as #N".
 *
 * Filing and marking are lib/dev/inspiration/craft.ts. A routine that will not
 * start leaves the idea filed and the takeaway crafted, and says so, so it can
 * be shaped from the ideas page rather than filed twice.
 */
// latency: pending -- fires the shape routine, which answers within a few seconds
export async function craftTakeaway(
  _prev: InspirationActionState,
  formData: FormData,
): Promise<InspirationActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing takeaway.' };

  const crafted = await fileTakeaway(supabase, user.id, id.data);
  revalidatePath(INSPIRATION_PATH);
  if (!crafted.ok) return { error: crafted.error };

  const shape = new FormData();
  shape.set('id', crafted.ideaId);
  const shaped = await shapeIdea({}, shape);
  revalidatePath(INSPIRATION_PATH);

  const filed = crafted.matched
    ? `This was already an idea ("${matchedName(crafted.matched)}"), so that one was used.`
    : 'Filed as an idea.';
  if (shaped.error) {
    return { error: `${filed} It was not sent to be shaped: ${shaped.error} Shape it from the Ideas page.` };
  }
  return { message: `${filed} Sent to Dash to shape; a proposed feature will appear on the plan page.` };
}

/** Put a takeaway aside. Only an open one: a crafted or covered one already has its place. */
// latency: pending
export async function dismissTakeaway(
  _prev: InspirationActionState,
  formData: FormData,
): Promise<InspirationActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing takeaway.' };

  const { error } = await supabase
    .from('inspiration_takeaways')
    .update({ status: 'dismissed', dismissed_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('id', id.data)
    .eq('status', 'open');
  if (error) return { error: error.message };

  revalidatePath(INSPIRATION_PATH);
  return { message: 'Dismissed.' };
}

/** The way back from the dismissed fold, as an open takeaway. */
// latency: pending
export async function restoreTakeaway(
  _prev: InspirationActionState,
  formData: FormData,
): Promise<InspirationActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing takeaway.' };

  const { error } = await supabase
    .from('inspiration_takeaways')
    .update({ status: 'open', dismissed_at: null })
    .eq('user_id', user.id)
    .eq('id', id.data)
    .eq('status', 'dismissed');
  if (error) return { error: error.message };

  revalidatePath(INSPIRATION_PATH);
  return { message: 'Back in the list.' };
}
