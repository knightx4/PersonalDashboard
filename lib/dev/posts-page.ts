import type { SupabaseClient } from '@supabase/supabase-js';
import { dayLabel } from '@/lib/dev/inspiration/view';
import { planHref } from '@/lib/search/sources/dev-map';
import { stepRef } from '@/lib/plan/ref';
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
  /** The images to draw: each entry of `image_paths` and its link (postImageSrc). */
  images: { path: string; src: string }[];
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

/** A cited step; `outline` is where the plan page places it, `1073.4`, when known. */
export type PostStepRow = { id: string; number: number; title: string; outline?: string | null };
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
        label: stepRef(step),
        title: step.title,
        href: planHref(step.number),
      });
    }
    for (const id of post.sourceFeedbackIds) {
      const note = notes.get(id);
      if (!note) continue;
      sources.push({ kind: 'note', id, label: 'a note', title: firstLine(note.body), href: `/dev/bugs#note-${id}` });
    }
    const images = post.imagePaths.flatMap((path) => {
      const src = postImageSrc(path);
      return src ? [{ path, src }] : [];
    });
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

  const [steps, outlines, notes] = await Promise.all([
    stepIds.length
      ? supabase.from('plan_items').select('id, number, title').eq('user_id', userId).in('id', stepIds)
      : Promise.resolve({ data: [], error: null }),
    // Each cited step's outline, so its chip reads as the plan page heads the row.
    stepIds.length
      ? supabase.from('plan_item_outlines').select('id, outline').eq('user_id', userId).in('id', stepIds)
      : Promise.resolve({ data: [], error: null }),
    noteIds.length
      ? supabase.from('feedback_items').select('id, body').eq('user_id', userId).in('id', noteIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (steps.error) throw new Error(`Could not read the steps the posts cite: ${steps.error.message}`);
  if (notes.error) throw new Error(`Could not read the notes the posts cite: ${notes.error.message}`);

  // A failed outline read leaves the chips on their numbers.
  const placed = new Map(
    ((outlines.error ? [] : (outlines.data ?? [])) as { id: string; outline: string }[]).map((row) => [row.id, row.outline]),
  );
  return buildPostsPage({
    posts,
    steps: ((steps.data ?? []) as PostStepRow[]).map((step) => ({ ...step, outline: placed.get(step.id) ?? null })),
    notes: (notes.data ?? []) as PostNoteRow[],
    run,
    now,
  });
}
