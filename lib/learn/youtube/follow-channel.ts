import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { addChannel, listChannel, removeChannelFromLibrary, type ListChannelResult } from './library';

/**
 * Acting on a found channel's verdict (plan #1198, under #1185).
 *
 * #1200 settled that Learn follows the channels it judges worth following
 * without asking, with an Unfollow beside each. So once a channel on
 * learn.subject_channels has its verdict:
 *
 * - follow: it goes into the YouTube library through addChannel, the same
 *   path as a channel pasted on /learn/youtube, and is listed at once when
 *   the run has time (a press does; the scheduled run leaves it to its next
 *   listing pass) so its videos are there to match against your ideas. Its row is marked
 *   decided 'followed'. New uploads are not set to transcribe automatically.
 * - pass: its row is marked decided 'passed'. The search in #1195 never
 *   suggests a channel already stored for the subject, so it stays away.
 *
 * Unfollowing takes the channel back out of the library, unless another of
 * your subjects followed it too, and marks the row 'unfollowed'.
 *
 * A row is marked only once its channel is in the library, so a YouTube
 * refusal leaves decided empty and the next press or scheduled run tries
 * again. Database errors throw.
 */

/** The library, replaceable in tests. */
export type LibraryWrites = {
  add: typeof addChannel;
  list: typeof listChannel;
  remove: typeof removeChannelFromLibrary;
};

const liveLibrary: LibraryWrites = { add: addChannel, list: listChannel, remove: removeChannelFromLibrary };

type JudgedRow = { id: string; youtube_channel_id: string; title: string; verdict: 'follow' | 'pass' };

/**
 * A first listing reads up to 5,000 uploads before the deadline is looked at,
 * so it is started only with this much of the run left. Otherwise the
 * scheduled run's listing pass lists the channel, as it lists every channel.
 */
const LIST_ROOM_MS = 60_000;

export type FollowedChannel = {
  id: string;
  title: string;
  slug: string;
  /** Null when the run had too little time left and the scheduled listing does it. */
  listing: ListChannelResult | null;
};

export type SettleResult = {
  followed: FollowedChannel[];
  passed: number;
  /** Channels judged worth following that YouTube would not add, left for the next run. */
  failed: { id: string; title: string; error: string }[];
};

/**
 * Follow or pass every channel of one subject that has a verdict and no
 * decision yet. `deadline` bounds the playlist walk of each new listing; what
 * it does not reach, the scheduled run's listing reads.
 */
export async function settleJudgedChannels(
  learn: LearnSupabaseClient,
  input: { userId: string; subjectId: string; deadline?: number; now?: () => Date; library?: LibraryWrites },
): Promise<SettleResult> {
  const { userId, subjectId } = input;
  const library = input.library ?? liveLibrary;
  const now = input.now ?? (() => new Date());
  const out: SettleResult = { followed: [], passed: 0, failed: [] };

  const { data, error } = await learn
    .from('subject_channels')
    .select('id, youtube_channel_id, title, verdict')
    .eq('user_id', userId)
    .eq('subject_id', subjectId)
    .not('verdict', 'is', null)
    .is('decided', null)
    .order('created_at');
  if (error) throw new Error(`Reading the judged channels failed: ${error.message}`);

  const mark = async (row: JudgedRow, decided: 'followed' | 'passed') => {
    const result = await learn
      .from('subject_channels')
      .update({ decided, decided_at: now().toISOString() })
      .eq('id', row.id)
      .eq('user_id', userId)
      .is('decided', null);
    if (result.error) throw new Error(`Marking ${row.title} ${decided} failed: ${result.error.message}`);
  };

  for (const row of (data ?? []) as JudgedRow[]) {
    if (row.verdict === 'pass') {
      await mark(row, 'passed');
      out.passed += 1;
      continue;
    }
    const added = await library.add(learn, row.youtube_channel_id);
    if (!added.ok) {
      out.failed.push({ id: row.id, title: row.title, error: added.error });
      continue;
    }
    // Marked before the listing, so a listing YouTube cuts short does not
    // add the channel a second time; the scheduled run lists it again.
    await mark(row, 'followed');
    const room = input.deadline === undefined || input.deadline - Date.now() >= LIST_ROOM_MS;
    const listing = room ? await library.list(learn, added.channel, { deadline: input.deadline }) : null;
    out.followed.push({ id: row.id, title: row.title, slug: added.channel.slug, listing });
  }
  return out;
}

export type UnfollowResult =
  | {
      ok: true;
      title: string;
      /** Taken out of the library, kept because another subject follows it, or already gone. */
      library: 'removed' | 'kept' | 'absent';
    }
  | { ok: false; error: string };

/**
 * Take a channel Learn followed for a subject back out of the library. The
 * channel stays in the library when another of your subjects followed it
 * too; either way this subject's row is marked 'unfollowed' and the channel
 * is not suggested for it again.
 */
export async function unfollowSubjectChannel(
  learn: LearnSupabaseClient,
  input: { userId: string; channelRowId: string; now?: () => Date; library?: LibraryWrites },
): Promise<UnfollowResult> {
  const { userId } = input;
  const library = input.library ?? liveLibrary;
  const now = input.now ?? (() => new Date());

  const row = await learn
    .from('subject_channels')
    .select('id, youtube_channel_id, title, decided')
    .eq('id', input.channelRowId)
    .eq('user_id', userId)
    .maybeSingle();
  if (row.error) throw new Error(`Reading the channel failed: ${row.error.message}`);
  const channel = row.data as { id: string; youtube_channel_id: string; title: string; decided: string | null } | null;
  if (!channel) return { ok: false, error: 'That channel is not one found for your subjects.' };
  if (channel.decided !== 'followed') return { ok: false, error: `${channel.title} is not followed.` };

  const marked = await learn
    .from('subject_channels')
    .update({ decided: 'unfollowed', decided_at: now().toISOString() })
    .eq('id', channel.id)
    .eq('user_id', userId);
  if (marked.error) throw new Error(`Marking ${channel.title} unfollowed failed: ${marked.error.message}`);

  const others = await learn
    .from('subject_channels')
    .select('id')
    .eq('user_id', userId)
    .eq('youtube_channel_id', channel.youtube_channel_id)
    .eq('decided', 'followed');
  if (others.error) throw new Error(`Checking other subjects for ${channel.title} failed: ${others.error.message}`);
  if ((others.data ?? []).length > 0) return { ok: true, title: channel.title, library: 'kept' };

  const provider = await learn
    .from('catalogue_providers')
    .select('id')
    .eq('youtube_channel_id', channel.youtube_channel_id)
    .maybeSingle();
  if (provider.error) throw new Error(`Finding ${channel.title} in the library failed: ${provider.error.message}`);
  if (!provider.data) return { ok: true, title: channel.title, library: 'absent' };
  await library.remove(learn, (provider.data as { id: string }).id);
  return { ok: true, title: channel.title, library: 'removed' };
}
