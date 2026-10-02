import type { SupabaseClient } from '@supabase/supabase-js';
import { dayLabel } from '@/lib/dev/inspiration/view';
import { planHref } from '@/lib/search/sources/dev-map';
import {
  loadLastPostsRun,
  loadSocialPosts,
  postImageSrc,
  postsRunState,
  type PostsRun,
  type PostsRunState,
  type SocialPost,
} from './posts';

/**
 * What the Posts tab in Dev draws (plan #1419): the drafts, each with the
 * steps and notes it came from resolved into links, and where the last run
 * stands.
 *
 * `buildPostsPage` is pure so the surface gallery can draw the same page from
 * fixtures; `loadPostsPage` is the read the route makes.
 */

/** A step or a note a draft cites, as the card links to it. */
export type PostSource = {
  kind: 'step' | 'note';
  id: string;
  /** "#1415" for a step, "a note" for a note. */
  label: string;
  /** The step's title or the note's first line, for the tooltip. */
  title: string;
  href: string;
};

export type PostCard = {
  post: SocialPost;
  sources: PostSource[];
  /** The screenshots to draw, already turned into links (postImageSrc). */
  images: string[];
  /** The day it was drafted, posted or dropped, whichever its status says. */
  day: string;
};

export type PostsPage = {
  suggested: PostCard[];
  posted: PostCard[];
  dropped: PostCard[];
  run: PostsRun | null;
  runState: PostsRunState;
};

export type PostStepRow = { id: string; number: number; title: string };
export type PostNoteRow = { id: string; body: string };

function firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim())?.trim() ?? '';
}

export function buildPostsPage(input: {
  posts: readonly SocialPost[];
  steps: readonly PostStepRow[];
  notes: readonly PostNoteRow[];
  run: PostsRun | null;
  now: number;
}): PostsPage {
  const steps = new Map(input.steps.map((step) => [step.id, step]));
  const notes = new Map(input.notes.map((note) => [note.id, note]));

  const card = (post: SocialPost): PostCard => {
    const sources: PostSource[] = [];
    // A cited step that has since been deleted is left out rather than shown
    // as a link to nothing.
    const cited = post.sourcePlanItemIds
      .map((id) => steps.get(id))
      .filter((step): step is PostStepRow => Boolean(step))
      .sort((a, b) => a.number - b.number);
    for (const step of cited) {
      sources.push({
        kind: 'step',
        id: step.id,
        label: `#${step.number}`,
        title: step.title,
        href: planHref(step.number),
      });
    }
    for (const id of post.sourceFeedbackIds) {
      const note = notes.get(id);
      if (!note) continue;
      sources.push({ kind: 'note', id, label: 'a note', title: firstLine(note.body), href: `/dev/bugs#note-${id}` });
    }
    const images = post.imagePaths
      .map(postImageSrc)
      .filter((src): src is string => Boolean(src));
    const when = post.status === 'posted' ? post.postedAt : post.status === 'dropped' ? post.droppedAt : null;
    return { post, sources, images, day: dayLabel(when ?? post.createdAt, new Date(input.now)) };
  };

  return {
    suggested: input.posts.filter((post) => post.status === 'suggested').map(card),
    posted: input.posts.filter((post) => post.status === 'posted').map(card),
    dropped: input.posts.filter((post) => post.status === 'dropped').map(card),
    run: input.run,
    runState: postsRunState(input.run, input.now),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export async function loadPostsPage(
  supabase: Db,
  userId: string,
  now: number = Date.now(),
): Promise<PostsPage> {
  const [posts, run] = await Promise.all([
    loadSocialPosts(supabase, userId),
    loadLastPostsRun(supabase, userId),
  ]);

  const stepIds = [...new Set(posts.flatMap((post) => post.sourcePlanItemIds))];
  const noteIds = [...new Set(posts.flatMap((post) => post.sourceFeedbackIds))];

  const [steps, notes] = await Promise.all([
    stepIds.length
      ? supabase.from('plan_items').select('id, number, title').eq('user_id', userId).in('id', stepIds)
      : Promise.resolve({ data: [], error: null }),
    noteIds.length
      ? supabase.from('feedback_items').select('id, body').eq('user_id', userId).in('id', noteIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (steps.error) throw new Error(`Could not read the steps the posts cite: ${steps.error.message}`);
  if (notes.error) throw new Error(`Could not read the notes the posts cite: ${notes.error.message}`);

  return buildPostsPage({
    posts,
    steps: (steps.data ?? []) as PostStepRow[],
    notes: (notes.data ?? []) as PostNoteRow[],
    run,
    now,
  });
}
