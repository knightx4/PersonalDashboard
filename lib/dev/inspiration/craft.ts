import type { SupabaseClient } from '@supabase/supabase-js';
import { findDuplicateIdea, ideaFirstLine, type FiledIdea } from '@/lib/ideas/duplicate';
import { loadFiledIdeas } from '@/lib/ideas/load';
import { clockTime, watchAt } from '@/lib/learn/youtube/format';
import { isModuleId, type ModuleId } from '@/lib/modules';

/**
 * Crafting a takeaway into the plan (plan #1413).
 *
 * The press files the takeaway as an idea in the workspace it touches, with
 * the videos and moments it came from, and marks the takeaway crafted with
 * that idea. The caller then sends the idea to the shape routine the same way
 * the Shape button on the ideas page does; the proposed feature arrives later,
 * and the tab reads "In the plan as #N" once the idea carries it.
 *
 * A merged takeaway is one row however many videos made the point, so
 * crafting it once covers all of them. Only an open takeaway can be crafted,
 * and the mark is written on the condition that it is still open, so a
 * second press (or a press from the same takeaway under another video) that
 * arrives while the first is in flight files nothing.
 */

/** The ideas table's own limit on a body. */
const IDEA_BODY_MAX = 4000;

export type CraftSource = {
  videoId: string;
  title: string;
  channel: string | null;
  quote: string | null;
  startSeconds: number | null;
};

/**
 * The idea a takeaway becomes: its title as the first line, the body under
 * it, then each video with a link to the moment. The first line is what the
 * ideas page and the duplicate check read as the idea's name.
 *
 * Quotes go first when the whole would not fit the ideas table, then the
 * body is shortened, so a long takeaway is still filed, links and all.
 */
export function craftIdeaBody(
  takeaway: { title: string; body: string },
  sources: readonly CraftSource[],
): string {
  const title = takeaway.title.trim();
  const lines = (withQuotes: boolean) =>
    sources.map((source) => {
      const at = source.startSeconds !== null ? `, at ${clockTime(source.startSeconds)}` : '';
      const by = source.channel ? ` (${source.channel})` : '';
      const link = watchAt(source.videoId, source.startSeconds ?? 0);
      const quote = withQuotes && source.quote?.trim() ? `\n  "${source.quote.trim()}"` : '';
      return `- ${source.title}${by}${at}: ${link}${quote}`;
    });
  const compose = (body: string, withQuotes: boolean) => {
    const head = `${title}\n\n${body}`;
    return sources.length === 0
      ? head
      : `${head}\n\nFrom the Dash inspiration playlist:\n${lines(withQuotes).join('\n')}`;
  };

  const body = takeaway.body.trim();
  const full = compose(body, true);
  if (full.length <= IDEA_BODY_MAX) return full;
  const bare = compose(body, false);
  if (bare.length <= IDEA_BODY_MAX) return bare;
  // Still too long: shorten the body, which keeps the links to the videos.
  const keep = Math.max(0, body.length - (bare.length - IDEA_BODY_MAX) - 1);
  const cut = compose(`${body.slice(0, keep)}…`, false);
  return cut.length <= IDEA_BODY_MAX ? cut : cut.slice(0, IDEA_BODY_MAX);
}

/** The workspace the idea is filed in: the takeaway's, or dev for the whole app. */
export function craftModule(module: string | null): ModuleId {
  return module && isModuleId(module) ? module : 'dev';
}

export type CraftResult =
  | {
      ok: true;
      /** The idea to send to be shaped. */
      ideaId: string;
      /** The idea already filed that this takeaway repeats, when it was one. */
      matched: FiledIdea | null;
    }
  | { ok: false; error: string };

const NOT_OPEN: Record<string, string> = {
  crafted: 'This takeaway has already been crafted.',
  covered: 'This takeaway is already an idea or in the plan.',
  dismissed: 'This takeaway was dismissed. Bring it back first.',
};

/**
 * File the takeaway as an idea and mark it crafted. Does not fire the shape
 * routine; the action does that with the idea this returns.
 *
 * When the takeaway repeats an idea already filed and not yet shaped (the
 * same check `scripts/plan.ts idea` refuses on), no second idea is written:
 * the takeaway is linked to that one and that one is what gets shaped.
 */
export async function craftTakeaway(
  supabase: SupabaseClient,
  userId: string,
  takeawayId: string,
): Promise<CraftResult> {
  const read = await supabase
    .from('inspiration_takeaways')
    .select('id, title, body, module, status')
    .eq('user_id', userId)
    .eq('id', takeawayId)
    .maybeSingle();
  if (read.error) return { ok: false, error: read.error.message };
  const takeaway = read.data as { title: string; body: string; module: string | null; status: string } | null;
  if (!takeaway) return { ok: false, error: 'That takeaway no longer exists.' };
  if (takeaway.status !== 'open') {
    return { ok: false, error: NOT_OPEN[takeaway.status] ?? 'This takeaway cannot be crafted.' };
  }

  const links = await supabase
    .from('inspiration_takeaway_videos')
    .select('video_id, quote, start_seconds')
    .eq('user_id', userId)
    .eq('takeaway_id', takeawayId);
  if (links.error) return { ok: false, error: links.error.message };
  const linkRows = (links.data ?? []) as Array<{ video_id: string; quote: string | null; start_seconds: number | null }>;

  const sources: CraftSource[] = [];
  if (linkRows.length > 0) {
    const videos = await supabase
      .from('inspiration_videos')
      .select('id, video_id, title, channel_title, playlist_position')
      .eq('user_id', userId)
      .in('id', linkRows.map((link) => link.video_id));
    if (videos.error) return { ok: false, error: videos.error.message };
    const byId = new Map(
      ((videos.data ?? []) as Array<{
        id: string;
        video_id: string;
        title: string | null;
        channel_title: string | null;
        playlist_position: number | null;
      }>).map((video) => [video.id, video]),
    );
    const ordered = linkRows
      .filter((link) => byId.has(link.video_id))
      .sort(
        (a, b) =>
          (byId.get(a.video_id)!.playlist_position ?? Infinity) -
          (byId.get(b.video_id)!.playlist_position ?? Infinity),
      );
    for (const link of ordered) {
      const video = byId.get(link.video_id)!;
      sources.push({
        videoId: video.video_id,
        title: video.title ?? video.video_id,
        channel: video.channel_title,
        quote: link.quote,
        startSeconds: link.start_seconds,
      });
    }
  }

  const body = craftIdeaBody(takeaway, sources);

  let filed: FiledIdea[];
  try {
    filed = await loadFiledIdeas(supabase, userId);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const match = findDuplicateIdea(body, filed);

  let ideaId: string;
  if (match) {
    ideaId = match.idea.id;
  } else {
    const inserted = await supabase
      .from('ideas')
      .insert({ user_id: userId, body, module: craftModule(takeaway.module) })
      .select('id')
      .single();
    if (inserted.error) return { ok: false, error: inserted.error.message };
    ideaId = String((inserted.data as { id: string }).id);
  }

  const marked = await supabase
    .from('inspiration_takeaways')
    .update({ status: 'crafted', idea_id: ideaId, crafted_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', takeawayId)
    .eq('status', 'open')
    .select('id');
  const won = !marked.error && (marked.data ?? []).length > 0;
  if (!won) {
    // Another press got there first, or the mark failed. The idea this press
    // wrote would be a second copy of one already sent, so it goes; a matched
    // idea was already there and stays.
    if (!match) await supabase.from('ideas').delete().eq('user_id', userId).eq('id', ideaId);
    return { ok: false, error: marked.error?.message ?? NOT_OPEN.crafted };
  }

  return { ok: true, ideaId, matched: match ? match.idea : null };
}

/** How a matched idea is named in the message after the press. */
export function matchedName(idea: FiledIdea): string {
  return ideaFirstLine(idea.body, 60);
}
