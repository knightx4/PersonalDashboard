import type { SupabaseClient } from '@supabase/supabase-js';
import { COMMENT_COLUMNS } from '@/lib/comments/load';
import {
  buildInspirationPage,
  type InspirationPage,
  type LinkRow,
  type SettingsRow,
  type TakeawayRowData,
  type VideoRow,
} from './view';

const VIDEO_COLUMNS =
  'id, video_id, title, channel_title, duration_seconds, thumbnail_url, playlist_position, added_at, left_playlist_at, transcript_state, transcript_error, processed_at, takeaway_count, process_error, summary_points';
const TAKEAWAY_COLUMNS = `id, title, body, module, status, idea_id, plan_item_id, created_at, score, dev_comments (${COMMENT_COLUMNS})`;
const LINK_COLUMNS = 'takeaway_id, video_id, said, quote, start_seconds';

/**
 * Everything the Inspiration tab shows (plan #1412), for one person.
 *
 * Four reads side by side, then the plan numbers the takeaways point at, in
 * one more: a takeaway covered by an idea that has since been shaped names the
 * idea's feature, so the ideas are read before the numbers.
 */
export async function loadInspiration(supabase: SupabaseClient, userId: string): Promise<InspirationPage> {
  const [settings, videos, takeaways, links] = await Promise.all([
    supabase
      .from('inspiration_settings')
      .select('youtube_playlist_id, playlist_read_at, playlist_error, run_started_at')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase.from('inspiration_videos').select(VIDEO_COLUMNS).eq('user_id', userId),
    supabase.from('inspiration_takeaways').select(TAKEAWAY_COLUMNS).eq('user_id', userId),
    supabase.from('inspiration_takeaway_videos').select(LINK_COLUMNS).eq('user_id', userId),
  ]);
  for (const result of [settings, videos, takeaways, links]) {
    if (result.error) throw new Error(`Could not read the inspiration playlist: ${result.error.message}`);
  }

  const takeawayRows = (takeaways.data ?? []) as TakeawayRowData[];

  const ideaIds = [...new Set(takeawayRows.map((row) => row.idea_id).filter((id): id is string => !!id))];
  const ideaPlanItems = new Map<string, string | null>();
  if (ideaIds.length > 0) {
    const ideas = await supabase.from('ideas').select('id, plan_item_id').eq('user_id', userId).in('id', ideaIds);
    if (ideas.error) throw new Error(`Could not read the ideas the takeaways name: ${ideas.error.message}`);
    for (const idea of ideas.data ?? []) ideaPlanItems.set(String(idea.id), idea.plan_item_id ?? null);
  }

  const planIds = [
    ...new Set(
      [...takeawayRows.map((row) => row.plan_item_id), ...ideaPlanItems.values()].filter(
        (id): id is string => !!id,
      ),
    ),
  ];
  const planNumbers = new Map<string, number>();
  if (planIds.length > 0) {
    const plan = await supabase.from('plan_items').select('id, number').eq('user_id', userId).in('id', planIds);
    if (plan.error) throw new Error(`Could not read the plan the takeaways name: ${plan.error.message}`);
    for (const item of plan.data ?? []) planNumbers.set(String(item.id), Number(item.number));
  }

  return buildInspirationPage({
    settings: (settings.data ?? null) as SettingsRow | null,
    videos: (videos.data ?? []) as VideoRow[],
    takeaways: takeawayRows,
    links: (links.data ?? []) as LinkRow[],
    planNumbers,
    ideaPlanItems,
  });
}
