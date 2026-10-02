import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * X posts Dash drafts about building this app (plan #1414).
 *
 * The Posts tab in Dev has a Suggest posts button. It starts one run of the
 * plan routine (job `posts` in `plan_runs`) that follows
 * `.claude/skills/posts/SKILL.md`: it reads what shipped since the last post,
 * drafts three to five posts to `docs/X-POSTS.md`, checks each with
 * `lib/dev/post-check.ts`, and inserts the ones that pass into
 * `social_posts` as suggested. Dash never posts; the person copies a draft,
 * posts it themselves and pastes the link back.
 *
 * This file is the part the tab and the run share: the row's shape, how X
 * counts a post, what the run is told, and whether a run is still going. It
 * is pure apart from the loaders, which only query the client they are
 * handed, so the browser can import the counter.
 */

/* -------------------------------------------------------------------------
 * The row
 * ---------------------------------------------------------------------- */

export type PostStatus = 'suggested' | 'posted' | 'dropped';
export const POST_STATUSES: readonly PostStatus[] = ['suggested', 'posted', 'dropped'];

export type SocialPost = {
  id: string;
  platform: 'x';
  /** The one idea the post is about, in a sentence. Compared against old ones. */
  angle: string;
  status: PostStatus;
  /** Dash's text as first written, one entry per post in the thread. Never edited. */
  draft: string[];
  /** The current text, same shape. The tab's edits change only this. */
  body: string[];
  sourcePlanItemIds: string[];
  sourceFeedbackIds: string[];
  imagePaths: string[];
  postedUrl: string | null;
  postedAt: string | null;
  droppedAt: string | null;
  /** The `plan_runs` row whose run drafted it. */
  runId: string | null;
  createdAt: string;
  updatedAt: string;
};

export const SOCIAL_POST_COLUMNS =
  'id, platform, angle, status, draft, body, source_plan_item_ids, source_feedback_ids, ' +
  'image_paths, posted_url, posted_at, dropped_at, run_id, created_at, updated_at';

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function socialPostFromRow(row: Record<string, unknown>): SocialPost {
  const status = POST_STATUSES.includes(row.status as PostStatus)
    ? (row.status as PostStatus)
    : 'suggested';
  return {
    id: String(row.id),
    platform: 'x',
    angle: String(row.angle ?? ''),
    status,
    draft: strings(row.draft),
    body: strings(row.body),
    sourcePlanItemIds: strings(row.source_plan_item_ids),
    sourceFeedbackIds: strings(row.source_feedback_ids),
    imagePaths: strings(row.image_paths),
    postedUrl: (row.posted_url as string | null) ?? null,
    postedAt: (row.posted_at as string | null) ?? null,
    droppedAt: (row.dropped_at as string | null) ?? null,
    runId: (row.run_id as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
  };
}

/** Suggested first, newest first within each status, then posted, then dropped. */
export function sortPosts(posts: readonly SocialPost[]): SocialPost[] {
  const rank: Record<PostStatus, number> = { suggested: 0, posted: 1, dropped: 2 };
  return [...posts].sort(
    (a, b) => rank[a.status] - rank[b.status] || b.createdAt.localeCompare(a.createdAt),
  );
}

/* -------------------------------------------------------------------------
 * Counting the way X counts
 * ---------------------------------------------------------------------- */

/** The limit for one post on an account without X Premium (docs/X-POSTS.md). */
export const X_POST_LIMIT = 280;
/** The room a draft leaves for the person's edits. Over this is a warning, not a failure. */
export const X_POST_MARGIN = 20;
/** What X counts any link as, whatever its length. */
export const X_LINK_LENGTH = 23;
/** A post and up to four more in its thread. */
export const MAX_THREAD_POSTS = 5;
/** How many drafts one run writes. */
export const MIN_SUGGESTIONS = 3;
export const MAX_SUGGESTIONS = 5;

/**
 * Links as X finds them: a scheme, a `www.`, or a bare domain on a common
 * top-level domain. Bare domains count because X turns them into links.
 */
export const LINK_PATTERN =
  /\b(?:https?:\/\/\S+|www\.\S+|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|dev|ai|app|co|uk|me|xyz|so|sh)\b(?:\/\S*)?)/gi;

/**
 * The code points X weighs at 1. Everything else weighs 2 (twitter-text v3:
 * Latin, punctuation and the general punctuation block are light; CJK and
 * most other scripts are heavy).
 */
const LIGHT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];

function codePointWeight(cp: number): number {
  return LIGHT_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi) ? 1 : 2;
}

const EMOJI = /\p{Extended_Pictographic}/u;

/**
 * How long X says a post is: a link is 23, an emoji is 2 however many code
 * points make it up, a CJK character is 2, and everything else is 1. Text is
 * normalised to NFC first, as X does.
 */
export function xLength(text: string): number {
  let links = 0;
  const rest = text.normalize('NFC').replace(LINK_PATTERN, () => {
    links += 1;
    return '';
  });
  let total = links * X_LINK_LENGTH;
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  for (const { segment } of segmenter.segment(rest)) {
    if (EMOJI.test(segment)) {
      total += 2;
      continue;
    }
    for (const char of segment) total += codePointWeight(char.codePointAt(0) ?? 0);
  }
  return total;
}

/** What the tab's counter shows for one post. */
export function xRemaining(text: string): number {
  return X_POST_LIMIT - xLength(text);
}

/* -------------------------------------------------------------------------
 * Starting a run, and telling whether it is still going
 * ---------------------------------------------------------------------- */

/**
 * How long a press holds the button off. A posts run reads the plan, drafts
 * and checks five posts and writes rows, which takes minutes rather than the
 * hours a build can. Past this, a run that has written nothing is counted as
 * failed, and the button is live again.
 */
export const POSTS_RUN_HOLD_MINUTES = 45;

/** One step to write about, for the changelog's "Post about this" (#1420). */
export type PostsRunFocus = { number: number };

/** The turn appended to the plan routine's session. */
export function postsRunText(input: { userId: string; focus?: PostsRunFocus | null }): string {
  const lines = [
    `Suggest X posts about building this app, for user_id ${input.userId}.`,
    '',
    'Read .claude/skills/posts/SKILL.md first and follow it, and read docs/X-POSTS.md in ' +
      'full before drafting. Check every draft with `npx tsx scripts/posts-check.ts` and insert ' +
      'only the ones that pass, as suggested rows in social_posts carrying this run in run_id. ' +
      'Then mark this run finished in plan_runs.',
    '',
    input.focus
      ? `Write one draft about plan step #${input.focus.number} only, citing that step. ` +
        'Skip the search for what shipped, but still check the step is one a post may come from.'
      : `Write ${MIN_SUGGESTIONS} to ${MAX_SUGGESTIONS} drafts about what shipped since the last posted row.`,
    '',
    'Dash never posts. You change rows, not code: do not commit or push, and do not touch ' +
      'any plan step.',
  ];
  return lines.join('\n');
}

/** The newest posts run, as `plan_runs` records it. */
export type PostsRun = {
  id: string;
  status: 'started' | 'finished' | 'failed';
  createdAt: string;
  error: string | null;
  /** The drafts in `social_posts` that carry this run's id. */
  drafts: number;
};

export type PostsRunState = 'idle' | 'going' | 'finished' | 'failed';

/**
 * Where the last run stands, for the button and the line beside it.
 *
 * The run inserts its drafts in one statement and then marks its own row
 * finished. A run that wrote drafts has done what it was for whatever its row
 * says, because the sweep in
 * `lib/plan/runs.ts` can mark a run with no pushes failed after thirty
 * minutes, and a posts run never pushes. Without drafts, a started run is
 * going until the hold runs out.
 *
 * `now` of 0 is the clock's pre-mount value: nothing ages out at that instant.
 */
export function postsRunState(run: PostsRun | null, now: number): PostsRunState {
  if (!run) return 'idle';
  if (run.status === 'finished' || run.drafts > 0) return 'finished';
  if (run.status === 'failed') return 'failed';
  if (now === 0) return 'going';
  const minutes = (now - new Date(run.createdAt).getTime()) / 60_000;
  return minutes < POSTS_RUN_HOLD_MINUTES ? 'going' : 'failed';
}

/* -------------------------------------------------------------------------
 * Loaders
 * ---------------------------------------------------------------------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

/** Every post for the account, suggested first. */
export async function loadSocialPosts(supabase: Db, userId: string): Promise<SocialPost[]> {
  const { data, error } = await supabase
    .from('social_posts')
    .select(SOCIAL_POST_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(`Could not read the posts: ${error.message}`);
  return sortPosts(((data ?? []) as unknown as Array<Record<string, unknown>>).map(socialPostFromRow));
}

/** The newest posts run and how many drafts it wrote, or null for none. */
export async function loadLastPostsRun(supabase: Db, userId: string): Promise<PostsRun | null> {
  const { data, error } = await supabase
    .from('plan_runs')
    .select('id, status, created_at, error')
    .eq('user_id', userId)
    .eq('job', 'posts')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Could not read the posts runs: ${error.message}`);
  const row = (data ?? [])[0] as
    | { id: string; status: string; created_at: string; error: string | null }
    | undefined;
  if (!row) return null;

  const { count } = await supabase
    .from('social_posts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('run_id', row.id);

  return {
    id: row.id,
    status: row.status === 'finished' || row.status === 'failed' ? row.status : 'started',
    createdAt: row.created_at,
    error: row.error,
    drafts: count ?? 0,
  };
}
