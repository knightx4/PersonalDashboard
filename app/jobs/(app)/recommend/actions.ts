'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { ensureCompany } from '@/lib/jobs/companies/ensure';
import { detectPosting } from '@/lib/jobs/ats';
import { runSuggestionsFor } from '@/lib/jobs/suggest/run';
import { scoreOpeningsFor } from '@/lib/jobs/suggest/score-run';
import { checkOpeningPostings } from '@/lib/jobs/suggest/posting';
import { isDismissReason } from '@/lib/jobs/suggest/feedback';
import { loadLatestRun, recordRuns, startRun } from '@/lib/jobs/suggest/search-runs';
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
 * pipeline as a lead; Dismiss turns a suggestion down so it is not made again,
 * and for a role says why, which the next roles search reads (feedback.ts).
 */

function revalidatePaths() {
  revalidatePath('/jobs/find');
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
  const supabase = await createClient();

  const latest = await loadLatestRun(supabase, user.id, 'apply');
  if (latest?.state === 'running') return { error: null, message: 'A search is already running.' };
  const runId = await startRun(supabase, user.id, 'apply', 'button');
  if (!runId) return { error: 'The search could not be started.' };
  const progress = recordRuns(supabase, user.id, 'button', { apply: runId });
  const began = Date.now();

  after(async () => {
    let result;
    // Roles at discovered startups are scored before they are written when
    // Jev is on, and what that costs is recorded as scoring.
    const discoveredSpend: SpendReport[] = [];
    const jev = (await jevEnabledFor(await createCoreClient(), user.id))
      ? { onSpend: (report: SpendReport) => discoveredSpend.push(report) }
      : null;
    try {
      result = await runSuggestionsFor(supabase, user.id, {
        apiKey,
        kinds: ['apply'],
        force: true,
        progress,
        // The search gets what is left of the page's five minutes; past this
        // it goes on as a Message Batch (lib/jobs/suggest/search-batch.ts).
        deadline: began + SEARCH_BUDGET_MS,
        jev,
      });
    } catch (error) {
      await progress.finish('apply', {
        written: 0,
        error: error instanceof Error ? error.message : 'The search could not be made.',
      });
      return;
    }
    const outcome = result.apply;
    await recordSessionSpend(user.id, { module: 'jobs', operation: 'find-openings' }, outcome.spend);
    await recordSessionSpend(user.id, { module: 'jobs', operation: 'score-openings' }, discoveredSpend);
    if (!outcome.ran) {
      await progress.finish('apply', { written: 0, error: 'Write a career goals entry or add a role first.' });
      return;
    }
    // Carried on as a batch: the run stays queued, and the collector stores
    // what it finds and closes it.
    if (outcome.queued) return;
    if (outcome.error || outcome.written === 0) {
      await progress.finish('apply', { written: outcome.written, error: outcome.error });
      return;
    }

    // Read and score the new roles now with what is left of the five
    // minutes; whatever does not fit is done by tomorrow's daily run.
    const left = () => AFTER_BUDGET_MS - (Date.now() - began);
    if (left() > 30_000) {
      await progress.stage('apply', 'postings', { written: outcome.written });
      await checkOpeningPostings(supabase, user.id, { budgetMs: Math.min(60_000, left() - 25_000) }).catch((err) =>
        console.error('[jobs suggestions] posting check', err instanceof Error ? err.message : err),
      );
    }
    if (left() > 20_000 && (await jevEnabledFor(await createCoreClient(), user.id))) {
      await progress.stage('apply', 'scoring');
      const scoreSpend: SpendReport[] = [];
      await scoreOpeningsFor(supabase, user.id, { onSpend: (report) => scoreSpend.push(report), limit: 20 }).catch(
        (err) => console.error('[jobs suggestions] score', err instanceof Error ? err.message : err),
      );
      await recordSessionSpend(user.id, { module: 'jobs', operation: 'score-openings' }, scoreSpend);
    }
    await progress.finish('apply', { written: outcome.written, error: null });
  });

  return { error: null };
}

/** How long the run after the response may take, inside the Find page's maxDuration of 300 seconds. */
const AFTER_BUDGET_MS = 270_000;
/** The part of it the board reads and the web search may use; the rest stores what they found. */
const SEARCH_BUDGET_MS = 255_000;

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

/** Turn a recommended role down, saying why. */
// latency: pending -- should be optimistic: a dismiss that waits for the round trip
export async function dismissOpening(id: string, reason: string): Promise<{ error: string | null }> {
  if (!isDismissReason(reason)) return { error: 'Choose a reason.' };
  return closeSuggestion(id, 'dismissed', { dismiss_reason: reason });
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
