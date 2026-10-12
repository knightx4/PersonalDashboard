import type { SupabaseClient } from '@supabase/supabase-js';
import { LINK_PATTERN } from '@/lib/dev/posts';

/**
 * Matching the posts read from X to Dash's drafts (plan #1820, feature #1815).
 *
 * After every read, each stored post that starts a thread (kind 'post'; a
 * quote post counts) is compared with the first post of each waiting and
 * dropped draft. Both are normalised first: X's HTML entities decoded, links
 * taken out (X rewrites every link as t.co), curly quotes and dashes made
 * plain, case folded and whitespace collapsed. The score is one minus the
 * edit distance over the longer text's length; one text found whole inside
 * the other scores at least MATCH_NEAR, so a draft cut short is asked about.
 *
 * - At MATCH_CLOSE or above the draft is marked posted with the post's link
 *   and date, and x_post_id set.
 * - At MATCH_NEAR or above it asks "Is this it?" (x_candidate_id), unless the
 *   person already said no to that post for that draft.
 *
 * Pairs are taken best first, so a post is matched to one draft and a draft
 * to one post. A post is only compared with drafts written before it went up,
 * give or take MATCH_SLACK_MS, which keeps years of history from being scored
 * against this week's drafts.
 *
 * A draft marked posted by hand keeps its link: it is never a candidate. When
 * its link names a post that has been read, only x_post_id is filled in, so
 * that post is not also listed as one the person wrote themselves.
 *
 * Replies to other people are never matched.
 */

/** A score at or above this marks the draft posted without asking. */
export const MATCH_CLOSE = 0.9;
/** A score at or above this (and under MATCH_CLOSE) asks "Is this it?". */
export const MATCH_NEAR = 0.6;
/** The shortest text that, found whole inside the other, is worth asking about. */
export const MATCH_CONTAINED_MIN = 40;
/** How long before a draft was written a post may still be it. */
export const MATCH_SLACK_MS = 2 * 24 * 60 * 60 * 1000;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

/** The text as compared: what the person wrote, without what X does to it. */
export function normalizePostText(text: string): string {
  return text
    .replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, name: string) => ENTITIES[name] ?? '')
    .normalize('NFKC')
    .replace(LINK_PATTERN, ' ')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Edit distance between two strings of code points. */
function levenshtein(a: readonly string[], b: readonly string[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * How alike two texts are, from 0 to 1, after normalising both. Pairs whose
 * lengths alone put them under MATCH_NEAR are not measured: the length gap is
 * returned, which is an upper bound on the score.
 */
export function postSimilarity(a: string, b: string): number {
  const na = normalizePostText(a);
  const nb = normalizePostText(b);
  const x = [...na];
  const y = [...nb];
  const longest = Math.max(x.length, y.length);
  if (longest === 0) return 0;
  const bound = 1 - Math.abs(x.length - y.length) / longest;
  // A post cut down to part of the draft, or a draft posted with more added,
  // is worth asking about however much was cut.
  const bare = (s: string) => s.replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  const [shorter, longer] = na.length <= nb.length ? [bare(na), bare(nb)] : [bare(nb), bare(na)];
  const contained = shorter.length >= MATCH_CONTAINED_MIN && longer.includes(shorter) ? MATCH_NEAR : 0;
  if (bound < MATCH_NEAR) return Math.max(bound, contained);
  return Math.max(1 - levenshtein(x, y) / longest, contained);
}

/** A stored post, as the match reads it. */
export type MatchPost = { xPostId: string; text: string; createdAt: string; url: string };

/** A draft, as the match reads it. */
export type MatchDraft = {
  id: string;
  status: 'suggested' | 'posted' | 'dropped';
  /** The first post of the thread as it stands now. */
  firstPost: string;
  /** The first post as Dash first wrote it, also compared. */
  firstDraft: string | null;
  createdAt: string;
  postedUrl: string | null;
  xPostId: string | null;
  xCandidateId: string | null;
  xDismissedIds: string[];
};

export type MatchPlan = {
  /** Drafts to mark posted, with the post that is them. */
  posted: { draftId: string; post: MatchPost; score: number }[];
  /** Drafts whose question changes: the post to ask about, or null to stop asking. */
  candidates: { draftId: string; xPostId: string | null }[];
  /** Drafts posted by hand whose link names a stored post: x_post_id only. */
  linked: { draftId: string; xPostId: string }[];
};

/** The X post id in a link to a post, such as https://x.com/me/status/123. */
export function xPostIdFromUrl(url: string | null): string | null {
  return url?.match(/\/status(?:es)?\/(\d+)/)?.[1] ?? null;
}

/** What one match changes. Pure, so the thresholds are tested on fixtures. */
export function planMatches(input: {
  posts: readonly MatchPost[];
  drafts: readonly MatchDraft[];
}): MatchPlan {
  const taken = new Set(input.drafts.flatMap((d) => (d.xPostId ? [d.xPostId] : [])));
  const stored = new Set(input.posts.map((p) => p.xPostId));

  const linked: MatchPlan['linked'] = [];
  for (const draft of input.drafts) {
    if (draft.status !== 'posted' || draft.xPostId) continue;
    const id = xPostIdFromUrl(draft.postedUrl);
    if (id && stored.has(id) && !taken.has(id)) {
      linked.push({ draftId: draft.id, xPostId: id });
      taken.add(id);
    }
  }

  const open = input.drafts.filter((d) => d.status !== 'posted' && !d.xPostId && !d.postedUrl);
  const pairs: { draft: MatchDraft; post: MatchPost; score: number }[] = [];
  for (const draft of open) {
    const from = Date.parse(draft.createdAt) - MATCH_SLACK_MS;
    for (const post of input.posts) {
      if (taken.has(post.xPostId) || Date.parse(post.createdAt) < from) continue;
      const score = Math.max(
        postSimilarity(draft.firstPost, post.text),
        draft.firstDraft && draft.firstDraft !== draft.firstPost ? postSimilarity(draft.firstDraft, post.text) : 0,
      );
      if (score >= MATCH_NEAR) pairs.push({ draft, post, score });
    }
  }
  // Best first; on a tie the earlier post, which is the one posted from the draft.
  pairs.sort((a, b) => b.score - a.score || a.post.createdAt.localeCompare(b.post.createdAt));

  const posted: MatchPlan['posted'] = [];
  const asking = new Map<string, string>();
  const usedDrafts = new Set<string>();
  for (const { draft, post, score } of pairs) {
    if (usedDrafts.has(draft.id) || taken.has(post.xPostId)) continue;
    if (score >= MATCH_CLOSE) {
      posted.push({ draftId: draft.id, post, score });
    } else if (!draft.xDismissedIds.includes(post.xPostId)) {
      asking.set(draft.id, post.xPostId);
    } else {
      continue;
    }
    usedDrafts.add(draft.id);
    taken.add(post.xPostId);
  }

  const candidates: MatchPlan['candidates'] = [];
  for (const draft of open) {
    if (posted.some((p) => p.draftId === draft.id)) continue;
    const next = asking.get(draft.id) ?? null;
    if (next !== draft.xCandidateId) candidates.push({ draftId: draft.id, xPostId: next });
  }
  return { posted, candidates, linked };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

/** What a match did, for the line Check X now answers with. */
export type MatchResult = { posted: number; asking: number };

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Match the person's stored posts to their drafts and write what changed.
 * Runs with the session client (Check X now) or the service client (the
 * cron, the callback), so every query names the user.
 */
export async function matchXPosts(db: Db, userId: string): Promise<MatchResult> {
  const { data: rows, error } = await db
    .from('social_posts')
    .select('id, status, body, draft, created_at, posted_url, x_post_id, x_candidate_id, x_dismissed_ids')
    .eq('user_id', userId)
    .limit(1000);
  if (error) throw new Error(`Could not read the drafts to match: ${error.message}`);

  const drafts: MatchDraft[] = ((rows ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    status: row.status as MatchDraft['status'],
    firstPost: stringList(row.body)[0] ?? '',
    firstDraft: stringList(row.draft)[0] ?? null,
    createdAt: String(row.created_at),
    postedUrl: (row.posted_url as string | null) ?? null,
    xPostId: (row.x_post_id as string | null) ?? null,
    xCandidateId: (row.x_candidate_id as string | null) ?? null,
    xDismissedIds: stringList(row.x_dismissed_ids),
  }));

  const open = drafts.filter((d) => d.status !== 'posted' && !d.xPostId && !d.postedUrl);
  const handIds = drafts.flatMap((d) =>
    d.status === 'posted' && !d.xPostId ? [xPostIdFromUrl(d.postedUrl)].filter((id): id is string => Boolean(id)) : [],
  );

  const posts: MatchPost[] = [];
  const toPost = (r: Record<string, unknown>): MatchPost => ({
    xPostId: String(r.x_post_id),
    text: String(r.text ?? ''),
    createdAt: String(r.created_at),
    url: String(r.url),
  });
  if (open.length) {
    const earliest = Math.min(...open.map((d) => Date.parse(d.createdAt))) - MATCH_SLACK_MS;
    const { data, error: postsError } = await db
      .from('x_posts')
      .select('x_post_id, text, created_at, url')
      .eq('user_id', userId)
      .eq('kind', 'post')
      .gte('created_at', new Date(earliest).toISOString())
      .order('created_at', { ascending: false })
      .limit(1000);
    if (postsError) throw new Error(`Could not read the posts to match: ${postsError.message}`);
    posts.push(...((data ?? []) as Record<string, unknown>[]).map(toPost));
  }
  const missing = handIds.filter((id) => !posts.some((p) => p.xPostId === id));
  if (missing.length) {
    const { data, error: linkError } = await db
      .from('x_posts')
      .select('x_post_id, text, created_at, url')
      .eq('user_id', userId)
      .in('x_post_id', missing);
    if (linkError) throw new Error(`Could not read the posts to link: ${linkError.message}`);
    posts.push(...((data ?? []) as Record<string, unknown>[]).map(toPost));
  }

  const plan = planMatches({ posts, drafts });

  let posted = 0;
  for (const { draftId, post } of plan.posted) {
    // Only a draft still unposted and with no link of its own is marked.
    const { data, error: e } = await db
      .from('social_posts')
      .update({
        status: 'posted',
        posted_url: post.url,
        posted_at: post.createdAt,
        dropped_at: null,
        x_post_id: post.xPostId,
        x_candidate_id: null,
      })
      .eq('user_id', userId)
      .eq('id', draftId)
      .in('status', ['suggested', 'dropped'])
      .is('posted_url', null)
      .select('id');
    if (e) throw new Error(`Could not mark a draft posted: ${e.message}`);
    posted += data?.length ?? 0;
  }

  let asking = 0;
  for (const { draftId, xPostId } of plan.candidates) {
    const { error: e } = await db
      .from('social_posts')
      .update({ x_candidate_id: xPostId })
      .eq('user_id', userId)
      .eq('id', draftId)
      .is('posted_url', null);
    if (e) throw new Error(`Could not offer a post for a draft: ${e.message}`);
    if (xPostId) asking++;
  }

  for (const { draftId, xPostId } of plan.linked) {
    const { error: e } = await db
      .from('social_posts')
      .update({ x_post_id: xPostId })
      .eq('user_id', userId)
      .eq('id', draftId)
      .is('x_post_id', null);
    if (e) throw new Error(`Could not link a posted draft: ${e.message}`);
  }

  return { posted, asking };
}
