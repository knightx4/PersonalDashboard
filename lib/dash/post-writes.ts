import type Anthropic from '@anthropic-ai/sdk';
import { isUuid } from '@/lib/ask/db';
import type { PostChangeInput, PostChangeKind } from '@/lib/ask/post-changes';
import { toRef } from '@/lib/core/refs';
import { checkDraft } from '@/lib/dev/post-check';
import { cleanThread, MAX_THREAD_POSTS, X_POST_LIMIT } from '@/lib/dev/posts';
import type { DashWriteContext, DashWriteResult, DashWriteTool } from './registry';

/**
 * The post changes Dash makes when asked (plan #2202.1, feature #2202):
 *
 *   rewrite_post  the text of an X post draft on the Posts tab replaced with
 *                 a new thread: shorter, reworded, split or joined.
 *
 * Only `body` changes. `draft` keeps what Dash first wrote, as the tab's own
 * edit leaves it (app/dev/posts/actions.ts, editPostBody), so the gap between
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

  const { data, error } = await db
    .from('social_posts')
    .update({ body: posts })
    .eq('id', ref)
    .eq('user_id', ctx.userId)
    .in('status', ['suggested', 'planned'])
    .select('*');
  if (error) throw new Error(`Rewriting the post draft failed: ${error.message}`);
  const after = (Array.isArray(data) ? data[0] : data) as Row | undefined;
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
  description: string,
  input_schema: Anthropic.Tool['input_schema'],
  run: (ctx: DashWriteContext, args: Args) => Promise<DashWriteResult>,
): DashWriteTool<DashWriteResult> {
  return {
    name,
    kind: 'write',
    definition: { name, description: `${description} ${DONE_NOTE}`, input_schema },
    apply: guarded(name, run),
  };
}

/** The post write tools, in the order the model is sent them. */
export const POST_WRITE_TOOLS: readonly DashWriteTool<DashWriteResult>[] = [
  tool(
    'rewrite_post',
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
];
