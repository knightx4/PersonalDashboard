'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/auth/server';
import { requireOwner } from '@/lib/dev/owner';
import { sourceProblems } from '@/lib/dev/post-check';
import { stepRef } from '@/lib/plan/ref';
import {
  angleFromPost,
  cleanThread,
  isUploadedPostImage,
  MAX_ANGLE,
  MAX_POST_ASK,
  MAX_POST_IMAGES,
  MAX_THREAD_POSTS,
  OPEN_POST_STATUSES,
  ownsPostImagePath,
  parsePostedUrl,
  POST_IMAGES_BUCKET,
} from '@/lib/dev/posts';
import { startPostsRun } from '@/lib/dev/posts-run';
import { POST_WANTS_MAX } from '@/lib/dev/posts-page';
import { formatNumber } from '@/lib/money';
import { decryptToken } from '@/lib/crypto/tokens';
import { freshXAccessToken, hasXMediaScope, hasXWriteScope, loadXAccount, XDisconnectedError } from '@/lib/x/account';
import { requestOrigin } from '@/lib/auth/origin';
import { isXOAuthConfigured, xClient, xOAuthEnv } from '@/lib/x/env';
import { revokeXToken } from '@/lib/x/oauth';
import { sendXThread, uploadXImage, X_MAX_IMAGES, XPostError, xPostUrl, xSendCheck, type XImage } from '@/lib/x/post';
import { runXRead, xRunMessage } from '@/lib/x/read';

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
 * Only postToX posts anywhere, and only when the person presses Post on one
 * draft and confirms it (plan #2072). Otherwise the person posts on X
 * themselves and pastes the link back.
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
  // Where the plan page places it, `#1073.4`, which is how the step is named
  // to the person and to the run. A failed read names it by number.
  const { data: placed } = await supabase
    .from('plan_item_outlines')
    .select('outline')
    .eq('user_id', user.id)
    .eq('id', step.id)
    .maybeSingle();
  const outline = (placed as { outline: string } | null)?.outline ?? null;
  const problems = sourceProblems({
    label: stepRef({ number: step.number, outline }),
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
    .in('status', OPEN_POST_STATUSES)
    .contains('source_plan_item_ids', [step.id])
    .limit(1);
  if (waitingError) return { error: waitingError.message };
  if (waiting?.length) return { error: 'A draft about this step is already on the Posts tab.' };

  const result = await startPostsRun({
    supabase,
    userId: user.id,
    focus: { number: number.data, outline },
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
    .in('status', OPEN_POST_STATUSES)
    .select('id');
  if (error) return { error: error.message };
  if (!data?.length) return { error: 'This draft is no longer waiting to be posted.' };

  revalidatePath(POSTS_PATH);
  return { message: 'Saved.' };
}

/**
 * What the person wants from their posts (plan #2227.2): the box under the
 * heading. The text is trimmed and kept as one row per person; emptied, the
 * row is deleted, so the next run drafts as it did before anything was said.
 */
// latency: pending
export async function savePostWants(
  _prev: PostsActionState,
  formData: FormData,
): Promise<PostsActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const raw = formData.get('wants');
  const wants = typeof raw === 'string' ? raw.trim() : '';
  if (wants.length > POST_WANTS_MAX) {
    return { error: `Keep it under ${formatNumber(POST_WANTS_MAX)} characters.` };
  }

  const { error } = wants
    ? await supabase.from('post_preferences').upsert({ user_id: user.id, wants }, { onConflict: 'user_id' })
    : await supabase.from('post_preferences').delete().eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath(POSTS_PATH);
  return { message: wants ? 'Saved.' : 'Cleared.' };
}

/**
 * A post the person wrote themselves. It joins the drafts as a suggested row
 * like any other, so it is edited, copied and marked posted the same way.
 * `draft` starts equal to `body`, as for Dash's, and no run made it.
 *
 * The thread comes in as separate boxes (`post` repeated). The angle is
 * optional: left blank it is the first post's opening sentence
 * (angleFromPost), since the next run reads every angle to avoid repeating one.
 *
 * Images were uploaded to the person's folder of the bucket before the form
 * was sent (upload-image.ts), so only their paths come in (`image`), each
 * checked to be theirs.
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

  const images = formData.getAll('image').map(String);
  if (images.length > MAX_POST_IMAGES) return { error: `A post takes at most ${MAX_POST_IMAGES} images.` };
  if (images.some((path) => !ownsPostImagePath(user.id, path))) {
    return { error: 'One of the images could not be found. Add it again.' };
  }

  const { error } = await supabase
    .from('social_posts')
    .insert({ user_id: user.id, angle, draft: body, body, image_paths: images });
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
    .in('status', OPEN_POST_STATUSES)
    .select('id');
  if (error) return { error: error.message };
  if (!data?.length) return { error: 'This draft is no longer waiting to be posted.' };

  revalidatePath(POSTS_PATH);
  return { message: 'Saved.' };
}

/**
 * Add an image the person uploaded to a waiting draft, up to four. The file
 * is already in their folder of the bucket; this records its path.
 */
// latency: pending
export async function addPostImage(
  _prev: PostsActionState,
  formData: FormData,
): Promise<PostsActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = idSchema.safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing post.' };
  const path = String(formData.get('path') ?? '');
  if (!ownsPostImagePath(user.id, path)) return { error: 'That image could not be found. Add it again.' };

  const { data: row, error: readError } = await supabase
    .from('social_posts')
    .select('image_paths')
    .eq('user_id', user.id)
    .eq('id', id.data)
    .in('status', OPEN_POST_STATUSES)
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (!row) return { error: 'This draft is no longer waiting to be posted.' };
  const current = (row.image_paths ?? []) as string[];
  if (current.length >= MAX_POST_IMAGES) return { error: `A post takes at most ${MAX_POST_IMAGES} images.` };

  const { error } = await supabase
    .from('social_posts')
    .update({ image_paths: [...current, path] })
    .eq('user_id', user.id)
    .eq('id', id.data)
    .in('status', OPEN_POST_STATUSES);
  if (error) return { error: error.message };

  revalidatePath(POSTS_PATH);
  return { message: 'Image added.' };
}

/**
 * Take an image off a waiting draft. An uploaded one is deleted from the
 * bucket as well; a committed screenshot stays in the repository, since
 * another draft may use it.
 */
// latency: pending
export async function removePostImage(
  _prev: PostsActionState,
  formData: FormData,
): Promise<PostsActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = idSchema.safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing post.' };
  const path = String(formData.get('path') ?? '');

  const { data: row, error: readError } = await supabase
    .from('social_posts')
    .select('image_paths')
    .eq('user_id', user.id)
    .eq('id', id.data)
    .in('status', OPEN_POST_STATUSES)
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (!row) return { error: 'This draft is no longer waiting to be posted.' };
  const current = (row.image_paths ?? []) as string[];
  if (!current.includes(path)) return {};

  const { error } = await supabase
    .from('social_posts')
    .update({ image_paths: current.filter((p) => p !== path) })
    .eq('user_id', user.id)
    .eq('id', id.data)
    .in('status', OPEN_POST_STATUSES);
  if (error) return { error: error.message };

  if (isUploadedPostImage(path) && ownsPostImagePath(user.id, path)) {
    // A file left behind costs a few hundred kilobytes; the draft is right either way.
    await supabase.storage.from(POST_IMAGES_BUCKET).remove([path]);
  }

  revalidatePath(POSTS_PATH);
  return { message: 'Image removed.' };
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
    .update({ status: 'posted', posted_url: link.url, posted_at: new Date().toISOString(), x_candidate_id: null })
    .eq('user_id', user.id)
    .eq('id', id.data)
    .in('status', OPEN_POST_STATUSES)
    .select('id');
  if (error) return { error: error.message };
  if (!data?.length) return { error: 'This draft is no longer waiting to be posted.' };

  revalidatePath(POSTS_PATH);
  return { message: 'Marked posted.' };
}

/**
 * "Is this it?", yes (plan #1820): mark the draft posted with the post a near
 * match offered, its link and the day it went up. Only while the draft is
 * still waiting or dropped, still asks about that post, and has no link of
 * its own.
 */
// latency: pending
export async function confirmXMatch(
  _prev: PostsActionState,
  formData: FormData,
): Promise<PostsActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = idSchema.safeParse(formData.get('id'));
  const xPostId = String(formData.get('x_post_id') ?? '');
  if (!id.success || !/^\d+$/.test(xPostId)) return { error: 'Missing post.' };

  const { data: post, error: postError } = await supabase
    .from('x_posts')
    .select('x_post_id, url, created_at')
    .eq('user_id', user.id)
    .eq('x_post_id', xPostId)
    .maybeSingle();
  if (postError) return { error: postError.message };
  if (!post) return { error: 'That post is no longer stored.' };

  const { data, error } = await supabase
    .from('social_posts')
    .update({
      status: 'posted',
      posted_url: post.url,
      posted_at: post.created_at,
      dropped_at: null,
      x_post_id: post.x_post_id,
      x_candidate_id: null,
    })
    .eq('user_id', user.id)
    .eq('id', id.data)
    .eq('x_candidate_id', xPostId)
    .in('status', [...OPEN_POST_STATUSES, 'dropped'])
    .is('posted_url', null)
    .select('id');
  if (error) return { error: error.message };
  if (!data?.length) return { error: 'This draft is no longer asking about that post.' };

  revalidatePath(POSTS_PATH);
  return { message: 'Marked posted.' };
}

/**
 * "Is this it?", no (plan #1820): stop asking, and never offer that post for
 * this draft again. The post is then listed under Posted on X.
 */
// latency: pending
export async function dismissXMatch(
  _prev: PostsActionState,
  formData: FormData,
): Promise<PostsActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = idSchema.safeParse(formData.get('id'));
  const xPostId = String(formData.get('x_post_id') ?? '');
  if (!id.success || !/^\d+$/.test(xPostId)) return { error: 'Missing post.' };

  const { data: row, error: readError } = await supabase
    .from('social_posts')
    .select('x_dismissed_ids')
    .eq('user_id', user.id)
    .eq('id', id.data)
    .eq('x_candidate_id', xPostId)
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (!row) return { error: 'This draft is no longer asking about that post.' };

  const dismissed = Array.isArray(row.x_dismissed_ids) ? (row.x_dismissed_ids as string[]) : [];
  const { error } = await supabase
    .from('social_posts')
    .update({ x_candidate_id: null, x_dismissed_ids: [...new Set([...dismissed, xPostId])] })
    .eq('user_id', user.id)
    .eq('id', id.data)
    .eq('x_candidate_id', xPostId);
  if (error) return { error: error.message };

  revalidatePath(POSTS_PATH);
  return { message: 'Not that one.' };
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
    .in('status', OPEN_POST_STATUSES);
  if (error) return { error: error.message };

  revalidatePath(POSTS_PATH);
  return { message: 'Dropped.' };
}

/**
 * Promote a suggested draft to planned (plan #2261.2). Changes the status and
 * nothing else; a press on a card that is no longer suggested does nothing.
 */
// latency: pending
export async function promotePost(
  _prev: PostsActionState,
  formData: FormData,
): Promise<PostsActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = idSchema.safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing post.' };

  const { error } = await supabase
    .from('social_posts')
    .update({ status: 'planned' })
    .eq('user_id', user.id)
    .eq('id', id.data)
    .eq('status', 'suggested');
  if (error) return { error: error.message };

  revalidatePath(POSTS_PATH);
  return { message: 'Planned.' };
}

/** The way back from planned, as a suggested draft (plan #2261.2). */
// latency: pending
export async function demotePost(
  _prev: PostsActionState,
  formData: FormData,
): Promise<PostsActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = idSchema.safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing post.' };

  const { error } = await supabase
    .from('social_posts')
    .update({ status: 'suggested' })
    .eq('user_id', user.id)
    .eq('id', id.data)
    .eq('status', 'planned');
  if (error) return { error: error.message };

  revalidatePath(POSTS_PATH);
  return { message: 'Back with the suggestions.' };
}

/**
 * The way back from the dropped fold, as a suggested draft. A dropped planned
 * post comes back suggested too: the row keeps no memory of what it was.
 */
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

/**
 * Disconnect X (plan #1818): remove the connection and its tokens. X is
 * asked to revoke the refresh token first, best effort, so the grant does not
 * outlive the row; the row goes whether or not X answers. Posts already read
 * stay in x_posts, and Connect X starts a fresh sign-in.
 */
// latency: pending -- one call to X, then a delete
export async function disconnectX(): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const account = await loadXAccount(supabase, user.id);
  if (!account) {
    revalidatePath(POSTS_PATH);
    return { ok: true };
  }

  if (isXOAuthConfigured() && account.refresh_token) {
    const env = xOAuthEnv();
    try {
      const token = decryptToken(account.refresh_token, env.TOKEN_ENCRYPTION_KEY);
      await revokeXToken(xClient(env), token, 'refresh_token');
    } catch (err) {
      console.error('x revoke', err);
    }
  }

  const { error } = await supabase.from('x_accounts').delete().eq('user_id', user.id).eq('id', account.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(POSTS_PATH);
  return { ok: true };
}

/**
 * Check X now (plan #1819): the daily read, run on demand for the person's
 * account. A first read pages through every post X returns, which takes a
 * minute or so; later ones are a request or two. A read X stops (rate limit,
 * no credit) answers with the line the tab also keeps showing.
 */
// latency: pending -- reads X, a second to a minute
export async function checkX(): Promise<{ ok: boolean; error?: string; message?: string }> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });
  if (!isXOAuthConfigured()) return { ok: false, error: 'The X keys are not set yet.' };

  const env = xOAuthEnv();
  try {
    const result = await runXRead(supabase, user.id, {
      trigger: 'manual',
      client: xClient(env),
      encryptionKey: env.TOKEN_ENCRYPTION_KEY,
    });
    revalidatePath(POSTS_PATH);
    const said = xRunMessage(result);
    return said.ok ? { ok: true, message: said.text } : { ok: false, error: said.text };
  } catch {
    revalidatePath(POSTS_PATH);
    return { ok: false, error: 'Something went wrong reading X. Try again in a minute.' };
  }
}

/** How long a send holds its claim on a draft before another press may take it. */
const X_SEND_CLAIM_MS = 2 * 60 * 1000;

/**
 * Post (plan #2072): send one waiting draft to X as the connected account,
 * a thread as a chain of replies, and mark it posted with the first post's
 * link: the same fields "Is this it?" fills in (confirmXMatch).
 *
 * Never automatic and never more than one draft: the tab sends one id after
 * the person confirms. The check's findings only warn (xSendCheck); the
 * person has seen them beside the button, and X refuses what it will not take.
 *
 * A double press sends nothing twice. The send first claims the draft by
 * setting x_sending_at where it is unset (or older than two minutes, so a
 * send that died does not hold it forever); a second press finds it claimed
 * and stops. Each post X accepts is stored in x_thread_ids before the next is
 * sent, so a thread that stops part-way carries on from there next time.
 */
// latency: pending -- one request to X per post, a second or two each
export async function postToX(formData: FormData): Promise<{ ok: boolean; error?: string; message?: string }> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = idSchema.safeParse(formData.get('id'));
  if (!id.success) return { ok: false, error: 'Missing post.' };
  if (!isXOAuthConfigured()) return { ok: false, error: 'The X keys are not set yet.' };

  const account = await loadXAccount(supabase, user.id);
  if (!account || account.status !== 'active') return { ok: false, error: 'Connect X on this tab first.' };
  if (!hasXWriteScope(account.scope)) {
    return { ok: false, error: 'The X sign-in cannot post yet. Press Disconnect, then Connect X, and try again.' };
  }

  const { data: row, error: readError } = await supabase
    .from('social_posts')
    .select('id, body, x_thread_ids, image_paths')
    .eq('user_id', user.id)
    .eq('id', id.data)
    .in('status', OPEN_POST_STATUSES)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!row) return { ok: false, error: 'This draft is no longer waiting to be posted.' };

  const body = Array.isArray(row.body) ? (row.body as unknown[]).map(String) : [];
  const already = Array.isArray(row.x_thread_ids) ? (row.x_thread_ids as string[]) : [];
  const check = xSendCheck({ body, sent: already.length });
  if (!check.ok) return { ok: false, error: 'Nothing left to send.' };

  // The images go on the first post, so they matter only while it is still to send.
  const imagePaths =
    already.length === 0 && Array.isArray(row.image_paths)
      ? (row.image_paths as unknown[]).map(String).slice(0, X_MAX_IMAGES)
      : [];
  if (imagePaths.length > 0 && !hasXMediaScope(account.scope)) {
    return {
      ok: false,
      error: 'The X sign-in cannot post images yet. Press Disconnect, then Connect X, and press Post again.',
    };
  }

  const claimedAt = new Date();
  const staleBefore = new Date(claimedAt.getTime() - X_SEND_CLAIM_MS).toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from('social_posts')
    .update({ x_sending_at: claimedAt.toISOString() })
    .eq('user_id', user.id)
    .eq('id', id.data)
    .in('status', OPEN_POST_STATUSES)
    .or(`x_sending_at.is.null,x_sending_at.lt.${staleBefore}`)
    .select('id');
  if (claimError) return { ok: false, error: claimError.message };
  if (!claimed?.length) return { ok: false, error: 'This draft is already being posted.' };

  let ids: string[];
  try {
    const env = xOAuthEnv();
    const token = await freshXAccessToken(supabase, account, {
      client: xClient(env),
      encryptionKey: env.TOKEN_ENCRYPTION_KEY,
    });
    const mediaIds: string[] = [];
    for (const path of imagePaths) {
      const image = await readPostImage(supabase, user.id, path);
      mediaIds.push(await uploadXImage({ token, image }));
    }
    ids = await sendXThread({
      token,
      posts: body,
      sent: already,
      mediaIds,
      onSent: async (sent) => {
        const { error } = await supabase
          .from('social_posts')
          .update({ x_thread_ids: sent })
          .eq('user_id', user.id)
          .eq('id', id.data);
        // The post is on X whatever this write did; log it rather than stop the thread.
        if (error) console.error('x post progress', error);
      },
    });
  } catch (err) {
    await supabase.from('social_posts').update({ x_sending_at: null }).eq('user_id', user.id).eq('id', id.data);
    revalidatePath(POSTS_PATH);
    if (err instanceof XDisconnectedError || err instanceof PostImageError) return { ok: false, error: err.message };
    if (err instanceof XPostError) {
      const up = err.sent.length;
      const partial =
        up > 0 && up < body.length ? ` Posts 1 to ${up} of ${body.length} are on X; Post sends the rest.` : '';
      return { ok: false, error: `${err.message}${partial}` };
    }
    console.error('x post', err);
    return { ok: false, error: 'Something went wrong posting to X. Check the account on X before trying again.' };
  }

  const { error } = await supabase
    .from('social_posts')
    .update({
      status: 'posted',
      posted_url: xPostUrl(account.handle, ids[0]!),
      posted_at: new Date().toISOString(),
      dropped_at: null,
      x_post_id: ids[0],
      x_candidate_id: null,
      x_thread_ids: ids,
      x_sending_at: null,
    })
    .eq('user_id', user.id)
    .eq('id', id.data);
  revalidatePath(POSTS_PATH);
  if (error) {
    console.error('x post mark posted', error);
    return { ok: false, error: `Posted on X, but the draft could not be marked posted: ${error.message}` };
  }
  return { ok: true, message: ids.length > 1 ? `Posted the thread of ${ids.length} to X.` : 'Posted to X.' };
}

class PostImageError extends Error {}

/**
 * The bytes of one of a draft's images, for uploading to X. An upload is read
 * from the private bucket on the person's session; a committed screenshot
 * (`/posts/…png`) is fetched from this site, and a full link as it is.
 */
async function readPostImage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  path: string,
): Promise<XImage> {
  const fail = () => new PostImageError('One of the draft’s images could not be read, so nothing was posted. Remove it or add it again, then press Post.');
  if (isUploadedPostImage(path)) {
    if (!ownsPostImagePath(userId, path)) throw fail();
    const { data, error } = await supabase.storage.from(POST_IMAGES_BUCKET).download(path);
    if (error || !data) throw fail();
    return { bytes: data, type: data.type || 'image/png' };
  }
  const url = /^https:\/\//.test(path) ? path : /^\/(?!\/)/.test(path) ? `${await requestOrigin()}${path}` : null;
  if (!url) throw fail();
  const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
  if (!res?.ok) throw fail();
  const type = res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  if (!type.startsWith('image/')) throw fail();
  return { bytes: await res.blob(), type };
}
