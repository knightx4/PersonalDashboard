'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { ensureCompany } from '@/lib/jobs/companies/ensure';
import { detectPosting } from '@/lib/jobs/ats';
import { runSuggestionsFor } from '@/lib/jobs/suggest/run';
import { scoreOpeningsFor } from '@/lib/jobs/suggest/score-run';
import { createCoreClient } from '@/lib/core/auth/server';
import { jevEnabledFor } from '@/lib/jev/enabled';
import type { SpendReport } from '@/lib/core/spend/pricing';

/**
 * Dash's recommendations (job_search.suggestions, 0028), shown at the top of
 * Roles and Contacts.
 *
 * The daily cron fills both lists. The two search presses run the same code
 * for the one person without waiting for the cadence, for when a list has run
 * dry. Sent adds the person as a
 * contact and logs the message in the outreach log; Save adds a posting to the
 * pipeline as a lead; Dismiss turns a suggestion down so it is not made again.
 */

function revalidatePaths() {
  revalidatePath('/jobs/roles');
  revalidatePath('/jobs/contacts');
}

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
  revalidatePaths();
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
  // The new openings get Jev's answers now rather than on tomorrow's run.
  if (result.apply.written > 0 && (await jevEnabledFor(await createCoreClient(), user.id))) {
    const scoreSpend: SpendReport[] = [];
    await scoreOpeningsFor(supabase, user.id, { onSpend: (report) => scoreSpend.push(report) }).catch((err) =>
      console.error('[jobs suggestions] score', err instanceof Error ? err.message : err),
    );
    await recordSessionSpend(user.id, { module: 'jobs', operation: 'score-openings' }, scoreSpend);
  }
  revalidatePaths();
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
  revalidatePaths();
  return { error: null };
}

// latency: pending -- should be optimistic: a dismiss that waits for the round trip
export async function dismissSuggestion(id: string): Promise<{ error: string | null }> {
  return closeSuggestion(id, 'dismissed');
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
    const source = (row.source_url as string | null) ?? null;
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .insert({
        user_id: user.id,
        company_id: company?.id ?? null,
        full_name: row.person_name,
        title: row.person_title,
        linkedin_url: source && /linkedin\.com\/in\//.test(source) ? source : null,
        relationship: 'cold',
        status: 'contacted',
        notes: source ? `Found by Dash: ${source}` : 'Found by Dash.',
      })
      .select('id')
      .single();
    if (contactError || !contact) return { error: contactError?.message ?? 'Could not add them as a contact.' };
    contactId = contact.id as string;
  }

  if (contactId) {
    const { error: touchError } = await supabase.from('contact_touches').insert({
      user_id: user.id,
      contact_id: contactId,
      channel: row.channel ?? 'other',
      direction: 'outbound',
      message: row.message,
    });
    if (touchError) return { error: touchError.message };
    await supabase
      .from('contacts')
      .update({ status: 'contacted' })
      .eq('id', contactId)
      .eq('user_id', user.id)
      .in('status', ['to_contact', 'dormant']);
    revalidatePath('/jobs/contacts');
  }
  return closeSuggestion(parsed.data, 'done', contactId ? { contact_id: contactId } : {});
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
