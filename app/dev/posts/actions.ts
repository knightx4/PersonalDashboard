'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/auth/server';
import { requireOwner } from '@/lib/dev/owner';
import { sourceProblems } from '@/lib/dev/post-check';
import {
  angleFromPost,
  cleanThread,
  MAX_ANGLE,
  MAX_POST_ASK,
  MAX_THREAD_POSTS,
  parsePostedUrl,
} from '@/lib/dev/posts';
import { startPostsRun } from '@/lib/dev/posts-run';

/**
 * The Posts tab's writes (plan #1419). Each one refuses anybody but the
 * owner in its own right, since an action can be posted without the Dev
 * layout ever rendering (#417), and ends by revalidating the page.
 *
 * Every write names the status it expects to find, so a press on a card
 * another tab already changed does nothing rather than undoing that change.
 * The table refuses a posted row without both its link and its time, and a
 * dropped row without its time, so each status goes in with its own fields
 * in the same update.
 *
 * Nothing here posts anywhere. The person posts on X themselves and pastes
 * the link back.
 */

export type PostsActionState = { error?: string; message?: string };

const POSTS_PATH = '/dev/posts';

const idSchema = z.string().uuid();

/**
 * Suggest posts: start a Dash run that drafts three to five posts about what
 * shipped since the last posted one (lib/dev/posts-run.ts). It is refused
 * while the last run is still going.
 *
 * With an `ask` in the form (note 114ff495), the run writes one draft about
 * what the person typed instead.
 *
 * No cost hint, the same as the other buttons that start a routine (shaping
 * an idea, a UI review, sending a step): the run is a Claude Code session,
 * not a priced model call, so the spend ledger has nothing to estimate it
 * from.
 */
// latency: pending -- starts a routine, which answers within a few seconds
export async function suggestPosts(
  _prev: PostsActionState,
  formData: FormData,
): Promise<PostsActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const raw = formData.get('ask');
  const ask = typeof raw === 'string' ? raw.trim() : '';
  if (ask.length > MAX_POST_ASK) {
    return { error: `Keep it under ${MAX_POST_ASK} characters.` };
  }

  const result = await startPostsRun({
    supabase,
    userId: user.id,
    focus: ask ? { ask } : null,
  });
  revalidatePath(POSTS_PATH);
  if (!result.ok) return { error: result.error };
  return { message: result.message };
}

/**
 * Post about this (plan #1420): the button on a changelog line. It starts the
 * same run as Suggest posts, told to write one draft about that one step.
 *
 * The changelog hides the button on lines a post may not come from, but an
 * action can be posted without the page, so the step is read again here: it
 * has to be a done build step in Dev or the app as a whole whose text passes
 * the source check, and not already the subject of a draft waiting on the
 * Posts tab.
 */
// latency: pending -- starts a routine, which answers within a few seconds
export async function suggestPostAbout(
  _prev: PostsActionState,
  formData: FormData,
): Promise<PostsActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const number = z.coerce.number().int().positive().safeParse(formData.get('number'));
  if (!number.success) return { error: 'Missing step.' };

  const { data: step, error } = await supabase
    .from('plan_items')
    .select('id, number, module, kind, status, title, detail, comment')
    .eq('user_id', user.id)
    .eq('number', number.data)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!step || step.status !== 'done' || step.kind !== 'build') {
    return { error: 'Only a step that has shipped can be posted about.' };
  }
  const problems = sourceProblems({
    label: `#${step.number}`,
    module: step.module ?? null,
    text: [step.title, step.detail, step.comment].filter(Boolean).join('\n'),
  });
  if (problems.length > 0) {
    return { error: 'This step touches another workspace, so Dash will not post about it.' };
  }

  const { data: waiting, error: waitingError } = await supabase
    .from('social_posts')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'suggested')
    .contains('source_plan_item_ids', [step.id])
    .limit(1);
  if (waitingError) return { error: waitingError.message };
  if (waiting?.length) return { error: 'A draft about this step is already on the Posts tab.' };

  const result = await startPostsRun({
    supabase,
    userId: user.id,
    focus: { number: number.data },
  });
  revalidatePath(POSTS_PATH);
  if (!result.ok) return { error: result.error };
  return { message: result.message };
}

/**
 * Save the text of a suggested draft. The form sends the whole thread as a
 * JSON array of strings; an emptied post drops out of it (cleanThread). Only
 * `body` changes: `draft` keeps what Dash first wrote.
 */
// latency: pending
export async function editPostBody(
  _prev: PostsActionState,
  formData: FormData,
): Promise<PostsActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = idSchema.safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing post.' };

  let posts: unknown;
  try {
    posts = JSON.parse(String(formData.get('body') ?? ''));
  } catch {
    return { error: 'Could not read the text.' };
  }
  const parsed = z.array(z.string()).safeParse(posts);
  if (!parsed.success) return { error: 'Could not read the text.' };
  const body = cleanThread(parsed.data);
  if (!body) {
    return {
      error:
        parsed.data.length > MAX_THREAD_POSTS
          ? `A thread is at most ${MAX_THREAD_POSTS} posts.`
          : 'A draft needs some text. Drop it instead if it is not worth posting.',
    };
  }

  const { data, error } = await supabase
    .from('social_posts')
    .update({ body })
    .eq('user_id', user.id)
    .eq('id', id.data)
    .eq('status', 'suggested')
    .select('id');
  if (error) return { error: error.message };
  if (!data?.length) return { error: 'This draft is no longer waiting to be posted.' };

  revalidatePath(POSTS_PATH);
  return { message: 'Saved.' };
}

/**
 * A post the person wrote themselves. It joins the drafts as a suggested row
 * like any other, so it is edited, copied and marked posted the same way.
 * `draft` starts equal to `body`, as for Dash's, and no run made it.
 *
 * The thread comes in as separate boxes (`post` repeated). The angle is
 * optional: left blank it is the first post's opening sentence
 * (angleFromPost), since the next run reads every angle to avoid repeating one.
 */
// latency: pending
export async function writePost(
  _prev: PostsActionState,
  formData: FormData,
): Promise<PostsActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const posts = formData.getAll('post').map((value) => (typeof value === 'string' ? value : ''));
  if (posts.length > MAX_THREAD_POSTS) return { error: `A thread is at most ${MAX_THREAD_POSTS} posts.` };
  const body = cleanThread(posts);
  if (!body) return { error: 'Write the post first.' };

  const rawAngle = formData.get('angle');
  const angle = (typeof rawAngle === 'string' ? rawAngle.trim() : '') || angleFromPost(body[0]!);
  if (angle.length > MAX_ANGLE) return { error: `Keep what it is about under ${MAX_ANGLE} characters.` };

  const { error } = await supabase
    .from('social_posts')
    .insert({ user_id: user.id, angle, draft: body, body });
  if (error) return { error: error.message };

  revalidatePath(POSTS_PATH);
  return { message: 'Added to your drafts.' };
}

/** Change what a suggested draft is about: its one-line angle. */
// latency: pending
export async function editPostAngle(
  _prev: PostsActionState,
  formData: FormData,
): Promise<PostsActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = idSchema.safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing post.' };
  const angle = String(formData.get('angle') ?? '').trim();
  if (!angle) return { error: 'Say what the post is about in a line.' };
  if (angle.length > MAX_ANGLE) return { error: `Keep it under ${MAX_ANGLE} characters.` };

  const { data, error } = await supabase
    .from('social_posts')
    .update({ angle })
    .eq('user_id', user.id)
    .eq('id', id.data)
    .eq('status', 'suggested')
    .select('id');
  if (error) return { error: error.message };
  if (!data?.length) return { error: 'This draft is no longer waiting to be posted.' };

  revalidatePath(POSTS_PATH);
  return { message: 'Saved.' };
}

/** Mark a suggested draft posted, with the link the person pasted back. */
// latency: pending
export async function markPostPosted(
  _prev: PostsActionState,
  formData: FormData,
): Promise<PostsActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = idSchema.safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing post.' };
  const link = parsePostedUrl(String(formData.get('url') ?? ''));
  if (!link.ok) return { error: link.error };

  const { data, error } = await supabase
    .from('social_posts')
    .update({ status: 'posted', posted_url: link.url, posted_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('id', id.data)
    .eq('status', 'suggested')
    .select('id');
  if (error) return { error: error.message };
  if (!data?.length) return { error: 'This draft is no longer waiting to be posted.' };

  revalidatePath(POSTS_PATH);
  return { message: 'Marked posted.' };
}

/**
 * Drop a suggested draft. Kept rather than deleted: a dropped angle is what
 * stops the next run suggesting it again.
 */
// latency: pending
export async function dropPost(
  _prev: PostsActionState,
  formData: FormData,
): Promise<PostsActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = idSchema.safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing post.' };

  const { error } = await supabase
    .from('social_posts')
    .update({ status: 'dropped', dropped_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('id', id.data)
    .eq('status', 'suggested');
  if (error) return { error: error.message };

  revalidatePath(POSTS_PATH);
  return { message: 'Dropped.' };
}

/** The way back from the dropped fold, as a suggested draft. */
// latency: pending
export async function restorePost(
  _prev: PostsActionState,
  formData: FormData,
): Promise<PostsActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = idSchema.safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing post.' };

  const { error } = await supabase
    .from('social_posts')
    .update({ status: 'suggested', dropped_at: null })
    .eq('user_id', user.id)
    .eq('id', id.data)
    .eq('status', 'dropped');
  if (error) return { error: error.message };

  revalidatePath(POSTS_PATH);
  return { message: 'Back with the drafts.' };
}
