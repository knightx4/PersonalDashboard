'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { ensureCompany } from '@/lib/jobs/companies/ensure';
import { addContact, addTouch, BEFORE_CONTACTED_AGAIN, markContacted, suggestedContact } from '@/lib/jobs/contacts/edit';
import { detectPosting } from '@/lib/jobs/ats';
import { startOpeningSearchFor, suggestPeopleFor } from '@/lib/jobs/suggest/press';
import { declineText } from '@/lib/jobs/suggest/decline-text';

/**
 * Dash's recommendations (job_search.suggestions, 0028): the roles and the
 * people to meet on Find.
 *
 * The daily cron fills both lists. The two search presses run the same code
 * for the one person without waiting for the cadence, for when a list has run
 * dry. Sent adds the person as a
 * contact and logs the message in the outreach log; Save adds a posting to the
 * pipeline as a lead; Dismiss turns a suggestion down so it is not made again,
 * and for a role says why, which the next roles search reads (feedback.ts).
 */

function revalidatePaths() {
  revalidatePath('/jobs/find');
}

export type SuggestState = { error: string | null; message?: string };

const SuggestionId = z.string().uuid();

// latency: pending -- a model call; the button says it is working
export async function suggestPeople(): Promise<SuggestState> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Suggestions are not configured.' };
  const user = await requireUser();
  const result = await suggestPeopleFor(user.id, apiKey);
  revalidatePaths();
  return result.error ? { error: result.error } : result.message ? { error: null, message: result.message } : { error: null };
}

/**
 * Search now on Recommended roles. The search reads the followed boards, runs
 * a web search and then reads and scores what it found, which together can
 * take longer than a request may wait. So this starts a run in
 * job_search.search_runs, answers at once, and does the work after the
 * response (next/server `after`) inside the page's five minutes. The section
 * reads the run's stage as it goes (search-runs.ts) and says how it ended.
 */
// latency: pending -- starts a background run and returns
export async function suggestOpenings(): Promise<SuggestState> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Suggestions are not configured.' };
  const user = await requireUser();
  const started = await startOpeningSearchFor(user.id, apiKey);
  return started.error ? { error: started.error } : started.message ? { error: null, message: started.message } : { error: null };
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
  revalidatePaths();
  return { error: null };
}

// latency: pending -- should be optimistic: a dismiss that waits for the round trip
export async function dismissSuggestion(id: string): Promise<{ error: string | null }> {
  return closeSuggestion(id, 'dismissed');
}

/** The toast's Undo on Decline (plan #1957.3): the suggestion is open again. */
// latency: pending
export async function reopenSuggestion(id: string): Promise<{ error: string | null }> {
  const parsed = SuggestionId.safeParse(id);
  if (!parsed.success) return { error: 'Could not tell which suggestion that was.' };
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from('suggestions')
    .update({ status: 'open', acted_at: null, dismiss_reason: null, dismiss_text: null })
    .eq('id', parsed.data)
    .eq('user_id', user.id)
    .eq('status', 'dismissed');
  if (error) return { error: error.message };
  revalidatePaths();
  return { error: null };
}

/**
 * Turn a recommended role down, with whatever the person typed in the box
 * (plan #2504.3), or nothing. The typed text goes in dismiss_text; the fixed
 * reason is left empty, which the feedback reads as "no reason given", so the
 * declines made from the old menu keep their reasons and still read the same.
 * With "Never this company" ticked (plan #2504.5) the fixed reason is the
 * company one Not this company set: openingsTaken reads it to keep that
 * company out of every later search, and nothing else changes.
 */
// latency: pending -- should be optimistic: a dismiss that waits for the round trip
export async function dismissOpening(
  id: string,
  text: string,
  neverCompany = false,
): Promise<{ error: string | null }> {
  return closeSuggestion(id, 'dismissed', {
    dismiss_reason: neverCompany === true ? 'company' : null,
    dismiss_text: declineText(text),
  });
}

/**
 * The message went out. Logged as a touch in the outreach log, with the text
 * as suggested, so response rates count it. Someone new becomes a contact
 * first (cold, contacted, with where Dash found them in the notes); a
 * suggestion to go to an event has nobody to log against and is only marked
 * done.
 */
// latency: pending -- should be optimistic: a tick that waits for the round trip
export async function markSuggestionSent(id: string): Promise<{ error: string | null }> {
  const parsed = SuggestionId.safeParse(id);
  if (!parsed.success) return { error: 'Could not tell which suggestion that was.' };
  const user = await requireUser();
  const supabase = await createClient();

  const { data: row, error: readError } = await supabase
    .from('suggestions')
    .select('contact_id, channel, message, person_name, person_title, company_name, source_url')
    .eq('id', parsed.data)
    .eq('user_id', user.id)
    .maybeSingle();
  if (readError || !row) return { error: readError?.message ?? 'That suggestion is gone.' };

  let contactId = (row.contact_id as string | null) ?? null;
  if (!contactId && row.person_name) {
    const company = row.company_name ? await ensureCompany(supabase, user.id, row.company_name as string) : null;
    if (company?.error) return { error: company.error };
    const { row: contact, error: contactError } = await addContact(supabase, user.id, suggestedContact(row, company?.id ?? null));
    if (contactError || !contact) return { error: contactError ?? 'Could not add them as a contact.' };
    contactId = contact.id as string;
  }

  if (contactId) {
    const { error: touchError } = await addTouch(supabase, user.id, {
      contact_id: contactId,
      channel: (row.channel as string | null) ?? 'other',
      direction: 'outbound',
      message: (row.message as string | null) ?? null,
    });
    if (touchError) return { error: touchError };
    await markContacted(supabase, user.id, contactId, BEFORE_CONTACTED_AGAIN);
    revalidatePath('/jobs/contacts');
  }
  return closeSuggestion(parsed.data, 'done', contactId ? { contact_id: contactId } : {});
}

/**
 * Save a suggested posting to the pipeline as a lead. The person stays where
 * they are to keep going through the recommendations; the new role appears in
 * the roles table, and its page fetches the description from the link.
 */
// latency: pending
export async function saveOpening(id: string): Promise<{ error: string | null }> {
  const parsed = SuggestionId.safeParse(id);
  if (!parsed.success) return { error: 'Could not tell which suggestion that was.' };
  const user = await requireUser();
  const supabase = await createClient();

  const { data: row, error: readError } = await supabase
    .from('suggestions')
    .select('headline, company_name, url, location, watchlist_startup_id')
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
  // A role at a startup weekly discovery found: the startup is now one of
  // their companies, so its watchlist row points there and is read no more.
  if (row.watchlist_startup_id) {
    const { error: linkError } = await supabase
      .from('watchlist_startups')
      .update({ company_id: company.id })
      .eq('id', row.watchlist_startup_id as string)
      .eq('user_id', user.id);
    if (linkError) console.error('[jobs suggestions] watchlist link', linkError.message);
  }

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
  return { error: null };
}
