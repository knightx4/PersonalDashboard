import { noButton, sameAs, type DashWriteRuns } from './runs';
import type Anthropic from '@anthropic-ai/sdk';
import { isUuid } from '@/lib/ask/db';
import type { PostChangeInput, PostChangeKind } from '@/lib/ask/post-changes';
import { toRef } from '@/lib/core/refs';
import { rewritePostBody } from '@/lib/dev/post-body';
import { checkDraft } from '@/lib/dev/post-check';
import { cleanThread, MAX_ANGLE, MAX_THREAD_POSTS, X_POST_LIMIT } from '@/lib/dev/posts';
import { listPostPictures } from './post-pictures';
import type { DashWriteContext, DashWriteResult, DashWriteTool } from './registry';

/**
 * The post changes Dash makes when asked (plan #2202.1, feature #2202):
 *
 *   rewrite_post  the text of an X post draft on the Posts tab replaced with
 *                 a new thread: shorter, reworded, split or joined.
 *   suggest_post  a new draft saved to the Posts tab, with an optional
 *                 gallery picture (plan #2384.3, feature #2384).
 *
 * A rewrite changes only `body`. `draft` keeps what Dash first wrote, as the tab's own
 * edit leaves it: both write through rewritePostBody (lib/dev/post-body.ts), so the gap between
 * the two still shows how the person edits.
 *
 * The new text is held to what a first draft is held to: at most five posts
 * (cleanThread), and the length, privacy and style rules of docs/X-POSTS.md
 * that a rule can catch (checkDraft in lib/dev/post-check.ts). A rewrite that
 * fails is refused with the reasons, and nothing is written, so the model can
 * try again or say why it could not.
 *
 * Only a draft still waiting to be posted is rewritten. A posted draft's text
 * is what went out on X, a dropped one was put aside by the person, and one
 * that is being sent, or is part-way on X, would no longer match what the
 * send carries on from. Each of those is refused.
 *
 * One row is updated, so the one undo rule in lib/core/dash-actions.ts puts
 * the text back from the values kept, and refuses once the text has changed
 * again since.
 *
 * A suggested draft is held to the checks the posts run's drafts pass
 * (scripts/posts-check.ts): checkDraft on the angle and the posts, with the
 * same terms kept out (.claude/skills/posts/SKILL.md, step 4: the person's
 * name, the companies and contacts in their job search). Its picture must be
 * one listPostPictures returns, by its site path. The row goes in as
 * `suggested` with `draft` and `body` the same text and `run_id` null, since
 * no posts run drafted it. Dash still never sends a post. Undo deletes the
 * row by the same rule, which refuses once the row has moved since: edited,
 * planned, dropped or posted.
 */

/** A refusal Dash reads and says in words. */
class Refused extends Error {}

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;

const TABLE = 'public.social_posts';
const POSTS_HREF = '/dev/posts';
const POST_PATHS = [POSTS_HREF, '/home'];

const DONE_NOTE =
  'It is done: it shows under your answer with an Undo. Say in your answer what you changed, and cite the row this returned.';

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

/** "Shipping the posts tab", cut to a line. */
function named(angle: unknown): string {
  const line = typeof angle === 'string' ? angle.split('\n')[0].trim() : '';
  if (!line) return 'the post draft';
  return line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line;
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((post, i) => post === b[i]);
}

/** "one post of 212 characters", "a thread of three posts". */
function shape(lengths: readonly number[]): string {
  if (lengths.length === 1) return `one post of ${lengths[0]} characters`;
  const words = ['', 'one', 'two', 'three', 'four', 'five'];
  return `a thread of ${words[lengths.length] ?? lengths.length} posts`;
}

async function rewritePost(ctx: DashWriteContext, args: Args): Promise<DashWriteResult> {
  if (!ctx.enabledModules.includes('dev')) {
    throw new Refused('The Dev workspace is switched off, so nothing can be changed there.');
  }

  const ref = typeof args.post_ref === 'string' ? args.post_ref.trim() : '';
  if (!ref) throw new Refused('post_ref is missing.');
  if (!isUuid(ref) || !ctx.seen(TABLE, ref)) {
    throw new Refused(`No lookup in this conversation returned ${TABLE} ${ref}. Look it up first and use the ref it gives.`);
  }

  if (!Array.isArray(args.posts) || args.posts.some((post) => typeof post !== 'string')) {
    throw new Refused('posts must be the whole new text, as a list of strings: one for each post in the thread.');
  }
  const posts = cleanThread(args.posts as string[]);
  if (!posts) {
    throw new Refused(
      (args.posts as string[]).length > MAX_THREAD_POSTS
        ? `A thread is at most ${MAX_THREAD_POSTS} posts.`
        : 'The new text is empty. A draft needs some text; dropping it is theirs to do on the Posts tab.',
    );
  }

  const db = await ctx.db('public');
  const { data: found, error: readError } = await db
    .from('social_posts')
    .select('*')
    .eq('id', ref)
    .eq('user_id', ctx.userId)
    .maybeSingle();
  if (readError) throw new Error(`Reading the post draft failed: ${readError.message}`);
  if (!found) throw new Refused('There is no post draft of theirs with that ref. Look it up first.');
  const before = found as Row;

  if (before.status === 'posted') {
    throw new Refused('That draft has been posted, so its text is what went out on X. Nothing was changed.');
  }
  if (before.status !== 'suggested' && before.status !== 'planned') {
    throw new Refused('That draft was put aside. Bringing it back is theirs to do on the Posts tab; nothing was changed.');
  }
  if (before.x_sending_at || strings(before.x_thread_ids).length > 0) {
    throw new Refused('Part of that draft is already on X, or it is being sent now, so its text cannot change. Nothing was changed.');
  }
  if (same(strings(before.body), posts)) {
    throw new Refused('That is the text the draft has already. Nothing was changed.');
  }

  // The angle is the tab's label and never goes to X, so only the posts are
  // held to the rules, as the send holds them (lib/x/post.ts, xSendCheck).
  const checked = checkDraft({ angle: 'A post', posts });
  if (!checked.ok) {
    throw new Refused(
      `The new text breaks the rules for a post (docs/X-POSTS.md): ${checked.problems.join('; ')}. ` +
        `Nothing was changed. Each post is at most ${X_POST_LIMIT} characters, with no links, hashtags, emoji, em dashes or private details; write it again within those.`,
    );
  }

  const { row: after, error } = await rewritePostBody(db, ctx.userId, ref, posts);
  if (error) throw new Error(`Rewriting the post draft failed: ${error}`);
  if (!after) throw new Refused('That draft is no longer waiting to be posted. Nothing was changed.');

  const what = named(before.angle);
  const rest = `: now ${shape(checked.lengths)}`;
  const input: PostChangeInput = {
    verb: 'Rewrote the post draft',
    what,
    rest,
    href: POSTS_HREF,
    where: 'Open Posts',
    paths: POST_PATHS,
  };
  return {
    ok: true,
    kind: 'rewrite_post' satisfies PostChangeKind,
    input: input as unknown as Record<string, unknown>,
    subjectRef: toRef(TABLE, ref),
    op: 'update',
    before,
    after,
    summary: `Dash rewrote the post draft "${what}"${rest}.`,
    row: {
      table: TABLE,
      ref,
      title: what,
      href: POSTS_HREF,
      detail: {
        posts: posts.join('\n\n'),
        lengths: checked.lengths.join(', '),
        ...(checked.warnings.length > 0 ? { warnings: checked.warnings.join('; ') } : {}),
      },
    },
  };
}

/** The terms a post must not name, as the posts run gathers them for scripts/posts-check.ts. */
async function avoidTerms(ctx: DashWriteContext): Promise<string[]> {
  const [pub, jobs] = await Promise.all([ctx.db('public'), ctx.db('job_search')]);
  const [profile, companies, contacts] = await Promise.all([
    pub.from('profiles').select('display_name').eq('id', ctx.userId).maybeSingle(),
    jobs.from('companies').select('name').eq('user_id', ctx.userId),
    jobs.from('contacts').select('full_name').eq('user_id', ctx.userId),
  ]);
  for (const read of [profile, companies, contacts]) {
    if (read.error) throw new Error(`Reading the terms to keep out failed: ${read.error.message}`);
  }
  const terms = new Set<string>();
  const name = (profile.data as Row | null)?.display_name;
  if (typeof name === 'string') for (const word of name.split(/\s+/)) terms.add(word);
  for (const row of (companies.data ?? []) as Row[]) if (typeof row.name === 'string') terms.add(row.name);
  for (const row of (contacts.data ?? []) as Row[]) if (typeof row.full_name === 'string') terms.add(row.full_name);
  return [...terms].map((t) => t.trim()).filter((t) => t.length >= 2);
}

async function suggestPost(ctx: DashWriteContext, args: Args): Promise<DashWriteResult> {
  if (!ctx.enabledModules.includes('dev')) {
    throw new Refused('The Dev workspace is switched off, so nothing can be saved there.');
  }

  const angle = typeof args.angle === 'string' ? args.angle.replace(/\s+/g, ' ').trim() : '';
  if (!angle) throw new Refused('angle is missing: the one idea the post is about, in a short line.');
  if (angle.length > MAX_ANGLE) throw new Refused(`The angle is at most ${MAX_ANGLE} characters.`);

  if (!Array.isArray(args.posts) || args.posts.some((post) => typeof post !== 'string')) {
    throw new Refused('posts must be the text, as a list of strings: one for each post in the thread.');
  }
  const posts = cleanThread(args.posts as string[]);
  if (!posts) {
    throw new Refused(
      (args.posts as string[]).length > MAX_THREAD_POSTS
        ? `A thread is at most ${MAX_THREAD_POSTS} posts.`
        : 'The text is empty. A draft needs at least one post.',
    );
  }

  let picture: string | null = null;
  if (args.picture !== undefined && args.picture !== null && args.picture !== '') {
    const wanted = typeof args.picture === 'string' ? args.picture.trim() : '';
    const found = (await listPostPictures()).find((p) => p.path === wanted);
    if (!found) {
      throw new Refused(
        `${wanted || 'That'} is not a gallery picture. Use a path the post_pictures lookup returned, or leave picture out. Nothing was saved.`,
      );
    }
    picture = found.path;
  }

  const checked = checkDraft({ angle, posts }, await avoidTerms(ctx));
  if (!checked.ok) {
    throw new Refused(
      `The draft breaks the rules for a post (docs/X-POSTS.md): ${checked.problems.join('; ')}. ` +
        `Nothing was saved. Each post is at most ${X_POST_LIMIT} characters, with no links, hashtags, emoji, em dashes or private details; write it again within those.`,
    );
  }

  const db = await ctx.db('public');
  const { data, error } = await db
    .from('social_posts')
    .insert({
      user_id: ctx.userId,
      platform: 'x',
      angle,
      status: 'suggested',
      draft: posts,
      body: posts,
      image_paths: picture ? [picture] : [],
      run_id: null,
    })
    .select('*');
  if (error) throw new Error(`Saving the post draft failed: ${error.message}`);
  const after = (Array.isArray(data) ? data[0] : data) as Row | undefined;
  if (!after || typeof after.id !== 'string') throw new Error('Saving the post draft returned no row.');
  const ref = after.id;

  const what = named(angle);
  const rest = `: ${shape(checked.lengths)}${picture ? ', with a picture' : ''}`;
  const input: PostChangeInput = {
    verb: 'Saved the post draft',
    what,
    rest,
    href: POSTS_HREF,
    where: 'Open Posts',
    paths: POST_PATHS,
  };
  return {
    ok: true,
    kind: 'suggest_post' satisfies PostChangeKind,
    input: input as unknown as Record<string, unknown>,
    subjectRef: toRef(TABLE, ref),
    op: 'insert',
    before: null,
    after,
    summary: `Dash saved the post draft "${what}"${rest}.`,
    row: {
      table: TABLE,
      ref,
      title: what,
      href: POSTS_HREF,
      detail: {
        posts: posts.join('\n\n'),
        lengths: checked.lengths.join(', '),
        ...(picture ? { picture } : {}),
        ...(checked.warnings.length > 0 ? { warnings: checked.warnings.join('; ') } : {}),
      },
    },
  };
}

/** Runs a write, turning a refusal or a failure into the sentence the model reads. Never throws. */
function guarded(name: string, run: (ctx: DashWriteContext, args: Args) => Promise<DashWriteResult>) {
  return async (ctx: DashWriteContext, input: unknown): Promise<DashWriteResult> => {
    const args = input && typeof input === 'object' ? (input as Args) : {};
    try {
      return await run(ctx, args);
    } catch (error) {
      if (error instanceof Refused) return { ok: false, error: error.message };
      console.error(`dash write ${name} failed`, error);
      return { ok: false, error: 'That change could not be made. Tell them nothing was changed.' };
    }
  };
}

function tool(
  name: PostChangeKind,
  runs: DashWriteRuns,
  description: string,
  input_schema: Anthropic.Tool['input_schema'],
  run: (ctx: DashWriteContext, args: Args) => Promise<DashWriteResult>,
): DashWriteTool<DashWriteResult> {
  return {
    name,
    kind: 'write',
    runs,
    definition: { name, description: `${description} ${DONE_NOTE}`, input_schema },
    apply: guarded(name, run),
  };
}

/** The post write tools, in the order the model is sent them. */
export const POST_WRITE_TOOLS: readonly DashWriteTool<DashWriteResult>[] = [
  tool(
    'rewrite_post',
    sameAs(['app/dev/posts/actions.ts#editPostBody', 'lib/dev/post-body.ts#rewritePostBody']),
    `Rewrite the text of one of their X post drafts on the Posts tab in Dev, when they ask ("make it shorter", "drop the second post", "say it more plainly"). Name the draft by the public.social_posts ref a lookup returned, or the draft the thread is on. Send posts as the whole new text, one string per post in the thread, at most ${MAX_THREAD_POSTS}; a post left out is gone from the thread. Keep to their wording where they did not ask for a change. Each post is at most ${X_POST_LIMIT} characters, with no links, hashtags, emoji, em dashes, @ mentions, amounts or anything from another workspace; a rewrite that breaks one is refused with the reasons, and nothing changes. A draft they have posted or put aside cannot be rewritten. What Dash first wrote is kept, so the tab still shows what changed.`,
    {
      type: 'object',
      properties: {
        post_ref: { type: 'string', description: 'The public.social_posts ref of the draft.' },
        posts: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: MAX_THREAD_POSTS,
          description: 'The whole new text: one string per post in the thread, in order.',
        },
      },
      required: ['post_ref', 'posts'],
      additionalProperties: false,
    },
    rewritePost,
  ),
  tool(
    'suggest_post',
    noButton(
      'No button saves a draft somebody wrote: Post about this on the changelog starts a posts run that drafts one (suggestPostAbout), which spends.',
    ),
    `Save a new X post draft to the Posts tab in Dev, when they ask you for a post about the app, how they build it, or something near it ("write a post about the new plan page"). Read what it rests on first (the plan steps and changelog, where it is about something that shipped), and write about what the app does, never what they keep in it. Send angle as the one idea the post is about, in a short line, and posts as the text, one string per post in the thread, at most ${MAX_THREAD_POSTS}. Each post is at most ${X_POST_LIMIT} characters, with no links, hashtags, emoji, em dashes, @ mentions, amounts, their name, the companies or people in their job search, or anything from another workspace; a draft that breaks one is refused with the reasons and nothing is saved, so fix them and call again. For picture, pass the path of one gallery picture the post_pictures lookup returned, of the screen the post is about, where one fits; leave it out otherwise. The draft waits on the Posts tab for them: you never post it.`,
    {
      type: 'object',
      properties: {
        angle: { type: 'string', description: 'The one idea the post is about, in a short line. Shown on the tab, never posted.' },
        posts: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: MAX_THREAD_POSTS,
          description: 'The text: one string per post in the thread, in order.',
        },
        picture: {
          type: 'string',
          description: 'Optional: the path of a gallery picture the post_pictures lookup returned, such as /posts/2026-10-18-dev-plan-tree.png.',
        },
      },
      required: ['angle', 'posts'],
      additionalProperties: false,
    },
    suggestPost,
  ),
];
