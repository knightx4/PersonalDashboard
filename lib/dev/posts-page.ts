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

/** A post read from X (plan #1820), as the tab draws it. */
export type XPostView = {
  xPostId: string;
  /** The whole post; for a thread, its first post. */
  text: string;
  url: string;
  /** The day it went up on X. */
  day: string;
  /** How many posts the thread has, counting this one; 1 for a single post. */
  threadPosts: number;
};

/** A stored post as the loader hands it to the builder. */
export type XStoredPost = {
  xPostId: string;
  text: string;
  url: string;
  createdAt: string;
  threadPosts: number;
};

export type PostCard = {
  post: SocialPost;
  /** The post a near match asks about on a waiting or dropped draft ("Is this it?"). */
  candidate: XPostView | null;
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
  /**
   * Posts on X that match no draft, newest first (plan #1820): `posts` is
   * the page of them drawn, `total` how many there are in all.
   */
  onX: { posts: XPostView[]; total: number };
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
  /** What was read from X: the posts drafts ask about, and the page of the rest. */
  x?: { candidates: readonly XStoredPost[]; listed: readonly XStoredPost[]; total: number };
}): PostsPage {
  const steps = new Map(input.steps.map((step) => [step.id, step]));
  const notes = new Map(input.notes.map((note) => [note.id, note]));
  const today = new Date(input.now);
  const xView = (p: XStoredPost): XPostView => ({
    xPostId: p.xPostId,
    text: p.text,
    url: p.url,
    day: dayLabel(p.createdAt, today),
    threadPosts: p.threadPosts,
  });
  const candidates = new Map((input.x?.candidates ?? []).map((p) => [p.xPostId, xView(p)]));

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
    const candidate =
      post.status !== 'posted' && post.xCandidateId ? (candidates.get(post.xCandidateId) ?? null) : null;
    return { post, candidate, sources, images, day: dayLabel(when ?? post.createdAt, today) };
  };

  return {
    suggested: input.posts.filter((post) => post.status === 'suggested').map(card),
    posted: input.posts.filter((post) => post.status === 'posted').map(card),
    dropped: input.posts.filter((post) => post.status === 'dropped').map(card),
    run: input.run,
    runState: postsRunState(input.run, input.now),
    onX: { posts: (input.x?.listed ?? []).map(xView), total: input.x?.total ?? 0 },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

/** How many posts from X the tab lists at first, and how many more each press adds. */
export const X_POSTS_PAGE = 50;

/** X returns at most the latest 3,200 posts, so a list never needs more. */
const X_POSTS_MAX = 3200;

/** The `onx` search parameter as a count to list, in whole pages. */
export function xPostsShown(raw: string | null | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= X_POSTS_PAGE) return X_POSTS_PAGE;
  return Math.min(Math.ceil(n / X_POSTS_PAGE) * X_POSTS_PAGE, X_POSTS_MAX);
}

/**
 * The posts read from X that the tab draws: the ones drafts ask about, and
 * the newest `shown` that no draft holds or asks about, each with how many
 * posts its thread has.
 */
async function loadXPosts(
  supabase: Db,
  userId: string,
  posts: readonly SocialPost[],
  shown: number,
): Promise<{ candidates: XStoredPost[]; listed: XStoredPost[]; total: number }> {
  const asked = [
    ...new Set(posts.flatMap((p) => (p.status !== 'posted' && p.xCandidateId ? [p.xCandidateId] : []))),
  ];
  // X post ids are digits, so the list can go in the filter as it is.
  const held = [
    ...new Set(posts.flatMap((p) => [p.xPostId, p.status === 'posted' ? null : p.xCandidateId]).filter((id): id is string => Boolean(id && /^\d+$/.test(id)))),
  ];
  const columns = 'x_post_id, text, url, created_at';

  let listQuery = supabase
    .from('x_posts')
    .select(columns, { count: 'exact' })
    .eq('user_id', userId)
    .eq('kind', 'post')
    .order('created_at', { ascending: false })
    .limit(shown);
  if (held.length) listQuery = listQuery.not('x_post_id', 'in', `(${held.join(',')})`);

  const [listed, candidates] = await Promise.all([
    listQuery,
    asked.length
      ? supabase.from('x_posts').select(columns).eq('user_id', userId).in('x_post_id', asked)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (listed.error) throw new Error(`Could not read your posts on X: ${listed.error.message}`);
  if (candidates.error) throw new Error(`Could not read the posts drafts ask about: ${candidates.error.message}`);

  const rows = [...(listed.data ?? []), ...(candidates.data ?? [])] as Array<Record<string, unknown>>;
  const ids = [...new Set(rows.map((r) => String(r.x_post_id)))];
  const threadPosts = new Map<string, number>();
  if (ids.length) {
    const { data, error } = await supabase
      .from('x_posts')
      .select('conversation_id')
      .eq('user_id', userId)
      .eq('kind', 'thread_reply')
      .in('conversation_id', ids);
    if (error) throw new Error(`Could not read your threads on X: ${error.message}`);
    for (const r of (data ?? []) as Array<{ conversation_id: string }>) {
      threadPosts.set(r.conversation_id, (threadPosts.get(r.conversation_id) ?? 0) + 1);
    }
  }
  const stored = (r: Record<string, unknown>): XStoredPost => ({
    xPostId: String(r.x_post_id),
    text: String(r.text ?? ''),
    url: String(r.url),
    createdAt: String(r.created_at),
    threadPosts: 1 + (threadPosts.get(String(r.x_post_id)) ?? 0),
  });
  return {
    candidates: ((candidates.data ?? []) as Array<Record<string, unknown>>).map(stored),
    listed: ((listed.data ?? []) as Array<Record<string, unknown>>).map(stored),
    total: listed.count ?? 0,
  };
}

export async function loadPostsPage(
  supabase: Db,
  userId: string,
  now: number = Date.now(),
  shown: number = X_POSTS_PAGE,
): Promise<PostsPage> {
  const [posts, run] = await Promise.all([
    loadSocialPosts(supabase, userId),
    loadLastPostsRun(supabase, userId),
  ]);

  const stepIds = [...new Set(posts.flatMap((post) => post.sourcePlanItemIds))];
  const noteIds = [...new Set(posts.flatMap((post) => post.sourceFeedbackIds))];

  const [steps, outlines, notes, x] = await Promise.all([
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
    loadXPosts(supabase, userId, posts, shown),
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
    x,
  });
}
