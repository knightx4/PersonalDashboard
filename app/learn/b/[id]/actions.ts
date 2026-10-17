'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { startEssayFromBrief } from '@/lib/learn/briefs/essay';
import { retryBriefFor } from '@/lib/learn/briefs/retry';
import { draftBriefTopic } from '@/lib/learn/briefs/topics-store';

/**
 * The brief page's writes (plan #2023.4): the short answer, the weekly check's
 * switch, archive, and Try again on a failed run, which starts the research
 * again. Every write goes through the
 * session client, so row-level security decides which brief is touched.
 */

const Id = z.string().uuid();
const SHORT_ANSWER_MAX = 4000;

function page(id: string) {
  revalidatePath(`/learn/b/${id}`);
  revalidatePath('/learn/now');
}

/**
 * Saves your edit of the short answer and marks it as yours, so the page
 * stops saying Dash wrote it. Returns an error to keep the editor open.
 */
// latency: pending
export async function saveShortAnswer(briefId: string, text: string): Promise<string | null> {
  const user = await requireUser();
  if (!Id.safeParse(briefId).success) return 'That brief could not be found.';
  const value = text.trim();
  if (value.length > SHORT_ANSWER_MAX) return `Keep it under ${SHORT_ANSWER_MAX} characters.`;
  const supabase = await createLearnClient();
  const { error } = await supabase
    .from('briefs')
    .update({ short_answer: value, short_answer_by: 'you', updated_at: new Date().toISOString() })
    .eq('id', briefId)
    .eq('user_id', user.id);
  if (error) return `Could not save it: ${error.message}`;
  page(briefId);
  return null;
}

/** Turns the weekly check for new sources on or off. */
// latency: optimistic
export async function setBriefWatch(briefId: string, on: boolean): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!Id.safeParse(briefId).success) return { error: 'That brief could not be found.' };
  const supabase = await createLearnClient();
  const { error } = await supabase
    .from('briefs')
    .update({ watch_on: on, updated_at: new Date().toISOString() })
    .eq('id', briefId)
    .eq('user_id', user.id);
  if (error) return { error: `Could not change it: ${error.message}` };
  page(briefId);
  return {};
}

/**
 * Archives the brief or brings it back. An archived brief leaves Learn's list
 * and is no longer checked; its reading list and sources stay.
 */
// latency: pending
export async function setBriefArchived(briefId: string, archived: boolean): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!Id.safeParse(briefId).success) return { error: 'That brief could not be found.' };
  const supabase = await createLearnClient();
  const { error } = await supabase
    .from('briefs')
    .update({ archived_at: archived ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq('id', briefId)
    .eq('user_id', user.id);
  if (error) return { error: `Could not ${archived ? 'archive' : 'restore'} it: ${error.message}` };
  page(briefId);
  return {};
}

/**
 * Try again on a failed run: puts the brief back to researching with the
 * error cleared, at the stage the run will start from, and starts the run
 * once the response has gone (plan #2023.2's runner, as Ask Dash starts it in
 * #2023.3). The run keeps the sub-questions the brief already has, skipping
 * the framing call when there are enough, and reuses readings already on the
 * list. The page re-reads itself while it researches.
 *
 * Only a failed brief is reset, so a second press while the first run is
 * going starts nothing. The page sets maxDuration for the run.
 */
// latency: pending
export async function retryBrief(briefId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!Id.safeParse(briefId).success) return { error: 'That brief could not be found.' };
  const result = await retryBriefFor(await createLearnClient(), user.id, briefId);
  if (!result.ok) return { error: result.error };
  page(briefId);
  return {};
}

/**
 * Start an essay from the brief (plan #2023.5): opens a new essay on the
 * brief's question with the brief pinned beside the draft, or the essay
 * already started from it. Makes no model call, so it records no spend; the
 * interview's later questions are priced where they are asked.
 */
// latency: pending
export async function startEssayOnBrief(briefId: string): Promise<{ error: string }> {
  const user = await requireUser();
  if (!Id.safeParse(briefId).success) return { error: 'That brief could not be found.' };
  const supabase = await createLearnClient();
  const { data, error } = await supabase
    .from('briefs')
    .select('id, question')
    .eq('id', briefId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) return { error: `Could not start the essay: ${error.message}` };
  if (!data) return { error: 'That brief could not be found.' };
  let essayId: string;
  try {
    essayId = await startEssayFromBrief(supabase, user.id, data as { id: string; question: string });
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : 'Could not start the essay.' };
  }
  redirect(`/learn/e/${essayId}`);
}

/**
 * Draft the topic a ready brief is about, under the goal chosen beside it
 * (plan #2184.1): the topic compiler run twice on the brief's pages and the
 * goal's performances. The draft opens on its own page, to be read and
 * approved; approving it puts it on the goal's lens and the brief under the
 * goal. The topics its links need are drafted from the same pages there.
 */
// latency: pending
export async function draftBriefTopics(briefId: string, aimId: string): Promise<{ error: string }> {
  const user = await requireUser();
  if (!Id.safeParse(briefId).success) return { error: 'That brief could not be found.' };
  if (!Id.safeParse(aimId).success) return { error: 'Choose the goal this research is for.' };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Drafting a topic needs ANTHROPIC_API_KEY to be set.' };
  let id: string;
  try {
    const result = await draftBriefTopic(await createLearnClient(), user.id, { briefId, aimId, anthropicApiKey: apiKey });
    if (!result.ok) return { error: result.detail };
    id = result.id;
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : 'Drafting the topic failed.' };
  }
  page(briefId);
  revalidatePath('/learn/topics');
  redirect(`/learn/topics/${id}`);
}
