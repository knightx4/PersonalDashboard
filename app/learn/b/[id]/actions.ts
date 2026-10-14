'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';

/**
 * The brief page's writes (plan #2023.4): the short answer, the weekly check's
 * switch, archive, and Try again on a failed run. Every write goes through the
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
 * error cleared, and the page starts watching for it to fill in.
 *
 * Starting the run itself belongs to the research runner (plan #2023.2,
 * built alongside this step). Until that is merged this only resets the row;
 * the merge connects the runner here, after the update.
 */
// latency: pending
export async function retryBrief(briefId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!Id.safeParse(briefId).success) return { error: 'That brief could not be found.' };
  const supabase = await createLearnClient();
  const { error } = await supabase
    .from('briefs')
    .update({ status: 'researching', error: null, updated_at: new Date().toISOString() })
    .eq('id', briefId)
    .eq('user_id', user.id)
    .eq('status', 'failed');
  if (error) return { error: `Could not start it again: ${error.message}` };
  page(briefId);
  return {};
}
