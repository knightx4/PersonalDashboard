'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { SNOOZE_DAYS } from '@/lib/jobs/today/load';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { ensureCompany } from '@/lib/jobs/companies/ensure';
import { detectPosting } from '@/lib/jobs/ats';
import { runSuggestionsFor } from '@/lib/jobs/suggest/run';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Done with a nudge.
 *
 * Completed rather than deleted: the reminder rules are keyed on `rule_key` and
 * an insert that collides is a no-op, so a deleted reminder would come straight
 * back on the next sweep. A completed one stays out of the way for good.
 */
// latency: pending -- should be optimistic: a tick that waits for the round trip
export async function completeReminder(id: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('reminders')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/jobs/today');
  // A to-do added from the role page's timeline is also shown there, so
  // finishing it here has to clear it there too.
  revalidatePath('/jobs/roles/[id]', 'page');
  // And on the company, which rolls up the to-dos of every role it has.
  revalidatePath('/jobs/companies/[slug]', 'page');
  return { error: null };
}

/** Not now. Pushes the nudge out rather than deciding anything about it. */
// latency: pending -- should be optimistic: a snooze that waits for the round trip
export async function snoozeReminder(id: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('reminders')
    .update({ due_at: new Date(Date.now() + SNOOZE_DAYS * DAY_MS).toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/jobs/today');
  revalidatePath('/jobs/roles/[id]', 'page');
  // And on the company, which rolls up the to-dos of every role it has.
  revalidatePath('/jobs/companies/[slug]', 'page');
  return { error: null };
}

/**
 * Dismiss a "Waiting on you" row on This week.
 *
 * It has no row of its own to mark done -- it is recomputed from the event log
 * on every load -- so the dismissal lives in its own small table instead,
 * upserted so re-dismissing an already-dismissed row just updates it rather
 * than erroring. `until: null` is "Done", for good; a date is "Later", the
 * same distinction reminders draw with completed_at vs due_at.
 */
async function dismissWaiting(
  eventId: string,
  until: string | null,
): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('waiting_dismissals')
    .upsert(
      { user_id: user.id, application_event_id: eventId, dismissed_until: until },
      { onConflict: 'user_id,application_event_id' },
    );

  if (error) return { error: error.message };
  revalidatePath('/jobs/today');
  return { error: null };
}

// latency: pending -- should be optimistic: a tick that waits for the round trip
export async function completeWaiting(eventId: string): Promise<{ error: string | null }> {
  return dismissWaiting(eventId, null);
}

// latency: pending -- should be optimistic: a snooze that waits for the round trip
export async function snoozeWaiting(eventId: string): Promise<{ error: string | null }> {
  return dismissWaiting(eventId, new Date(Date.now() + SNOOZE_DAYS * DAY_MS).toISOString());
}

/**
 * Dash's suggestions (job_search.suggestions, 0028).
 *
 * The two suggest presses run the same code as the daily cron, for the one
 * person and without waiting for the cadence. Sent logs the message in the
 * outreach log and marks the contact contacted; Save adds a posting to the
 * pipeline as a lead; Dismiss turns a suggestion down so it is not made again.
 */

export type SuggestState = { error: string | null; message?: string };

const SuggestionId = z.string().uuid();

function suggestMessage(written: number, what: string): SuggestState {
  if (written === 0) return { error: null, message: `Dash found no ${what} worth suggesting right now.` };
  return { error: null };
}

// latency: pending -- a model call; the button says it is working
export async function suggestPeople(): Promise<SuggestState> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Suggestions are not configured.' };
  const user = await requireUser();
  const supabase = await createClient();

  let result;
  try {
    result = await runSuggestionsFor(supabase, user.id, { apiKey, kinds: ['reach_out'], force: true });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'The suggestions could not be made.' };
  }
  await recordSessionSpend(user.id, { module: 'jobs', operation: 'suggest-outreach' }, result.reach_out.spend);
  revalidatePath('/jobs/today');
  if (result.reach_out.error) return { error: result.reach_out.error };
  if (!result.reach_out.ran) return { error: null, message: 'Write a career goals entry or add a role first.' };
  return suggestMessage(result.reach_out.written, 'new people');
}

// latency: pending -- a web search; the button says it is working
export async function suggestOpenings(): Promise<SuggestState> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Suggestions are not configured.' };
  const user = await requireUser();
  const supabase = await createClient();

  let result;
  try {
    result = await runSuggestionsFor(supabase, user.id, { apiKey, kinds: ['apply'], force: true });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'The search could not be made.' };
  }
  await recordSessionSpend(user.id, { module: 'jobs', operation: 'find-openings' }, result.apply.spend);
  revalidatePath('/jobs/today');
  if (result.apply.error) return { error: result.apply.error };
  if (!result.apply.ran) return { error: null, message: 'Write a career goals entry or add a role first.' };
  return suggestMessage(result.apply.written, 'new postings');
}

async function closeSuggestion(
  id: string,
  status: 'done' | 'dismissed',
  extra: Record<string, unknown> = {},
): Promise<{ error: string | null }> {
  const parsed = SuggestionId.safeParse(id);
  if (!parsed.success) return { error: 'Could not tell which suggestion that was.' };
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from('suggestions')
    .update({ status, acted_at: new Date().toISOString(), ...extra })
    .eq('id', parsed.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };
  revalidatePath('/jobs/today');
  return { error: null };
}

// latency: pending -- should be optimistic: a dismiss that waits for the round trip
export async function dismissSuggestion(id: string): Promise<{ error: string | null }> {
  return closeSuggestion(id, 'dismissed');
}

/**
 * The message went out. Logged as a touch on the contact, with the text as
 * suggested, so the outreach log and response rates count it; a suggestion to
 * find someone new has no contact yet and is only marked done.
 */
// latency: pending -- should be optimistic: a tick that waits for the round trip
export async function markSuggestionSent(id: string): Promise<{ error: string | null }> {
  const parsed = SuggestionId.safeParse(id);
  if (!parsed.success) return { error: 'Could not tell which suggestion that was.' };
  const user = await requireUser();
  const supabase = await createClient();

  const { data: row, error: readError } = await supabase
    .from('suggestions')
    .select('contact_id, channel, message')
    .eq('id', parsed.data)
    .eq('user_id', user.id)
    .maybeSingle();
  if (readError || !row) return { error: readError?.message ?? 'That suggestion is gone.' };

  if (row.contact_id) {
    const { error: touchError } = await supabase.from('contact_touches').insert({
      user_id: user.id,
      contact_id: row.contact_id,
      channel: row.channel ?? 'other',
      direction: 'outbound',
      message: row.message,
    });
    if (touchError) return { error: touchError.message };
    await supabase
      .from('contacts')
      .update({ status: 'contacted' })
      .eq('id', row.contact_id)
      .eq('user_id', user.id)
      .in('status', ['to_contact', 'dormant']);
    revalidatePath('/jobs/contacts');
  }
  return closeSuggestion(parsed.data, 'done');
}

/**
 * Save a suggested posting to the pipeline as a lead, then open its role page,
 * where the description can be fetched from the link.
 */
// latency: pending -- redirects to the new role
export async function saveOpening(id: string): Promise<{ error: string | null }> {
  const parsed = SuggestionId.safeParse(id);
  if (!parsed.success) return { error: 'Could not tell which suggestion that was.' };
  const user = await requireUser();
  const supabase = await createClient();

  const { data: row, error: readError } = await supabase
    .from('suggestions')
    .select('headline, company_name, url, location')
    .eq('id', parsed.data)
    .eq('user_id', user.id)
    .eq('kind', 'apply')
    .maybeSingle();
  if (readError || !row) return { error: readError?.message ?? 'That suggestion is gone.' };

  const url = row.url as string;
  const detected = detectPosting(url);
  const company = await ensureCompany(supabase, user.id, (row.company_name as string | null) ?? 'Unknown company', {
    careersUrl: url,
    boardToken: detected?.boardToken ?? null,
    ats: detected?.vendor === 'other' || detected?.vendor === 'unknown' ? null : detected?.vendor,
  });
  if (company.error) return { error: company.error };

  const { data: role, error: roleError } = await supabase
    .from('roles')
    .insert({
      user_id: user.id,
      company_id: company.id,
      title: row.headline,
      jd_url: url,
      ats_job_id: detected?.jobId ?? null,
      location: row.location,
      source: 'portal',
    })
    .select('id')
    .single();
  if (roleError || !role) return { error: roleError?.message ?? 'Could not save the role.' };

  const { error: applicationError } = await supabase.from('applications').insert({
    user_id: user.id,
    role_id: role.id,
    source: 'portal',
    created_by: 'manual',
  });
  if (applicationError) return { error: applicationError.message };

  const closed = await closeSuggestion(parsed.data, 'done', { role_id: role.id });
  if (closed.error) return closed;
  revalidatePath('/jobs/pipeline');
  revalidatePath('/jobs/roles');
  redirect(`/jobs/roles/${role.id}`);
}
