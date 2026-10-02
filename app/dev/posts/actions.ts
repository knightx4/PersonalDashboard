'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/auth/server';
import { requireOwner } from '@/lib/dev/owner';
import { cleanThread, MAX_THREAD_POSTS, parsePostedUrl } from '@/lib/dev/posts';
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
 * No cost hint, the same as the other buttons that start a routine (shaping
 * an idea, a UI review, sending a step): the run is a Claude Code session,
 * not a priced model call, so the spend ledger has nothing to estimate it
 * from.
 */
// latency: pending -- starts a routine, which answers within a few seconds
export async function suggestPosts(): Promise<PostsActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const result = await startPostsRun({ supabase, userId: user.id });
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
