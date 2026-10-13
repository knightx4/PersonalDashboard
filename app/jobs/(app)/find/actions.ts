'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { runWeeklyDiscovery, type WeeklyOutcome } from '@/lib/jobs/discover/weekly';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { ensureCompany } from '@/lib/jobs/companies/ensure';

export interface AimState {
  error?: string;
}

const aimSchema = z.object({
  field: z.enum(['targetTitles', 'excludedIndustries']),
  value: z.string().trim().max(2000, 'Keep the list under 2,000 characters.'),
});

/**
 * Target titles or the industries never to suggest, saved from the field on
 * Find where they are shown (law 12). Both are comma lists on the profile; the
 * classifier and the scores read the titles, the searches leave out the
 * industries.
 */
// latency: pending -- saves one value where it is shown
export async function saveAim(_prev: AimState, form: FormData): Promise<AimState> {
  const parsed = aimSchema.safeParse({ field: form.get('field'), value: form.get('value') ?? '' });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const list = parsed.data.value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const patch =
    parsed.data.field === 'targetTitles' ? { target_titles: list } : { excluded_industries: list };

  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
  if (error) return { error: error.message };
  revalidatePath('/jobs/find');
  return {};
}

export interface DiscoveryActionState {
  error: string | null;
  message?: string;
}

/** Leaves the page's five minutes room to render after the run. */
const DISCOVERY_BUDGET_MS = 240_000;

/**
 * The Find startups button: a new shortlist from the YC and Hacker News
 * hiring lists, scored for fit, then the job boards of what it found
 * (lib/jobs/discover/weekly.ts). The weekly run does the same on Mondays; this
 * one runs even when the week's has finished, and not while one is working.
 */
// latency: pending
export async function findStartups(): Promise<DiscoveryActionState> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'The startup search is not configured.' };

  const user = await requireUser();
  const supabase = await createClient();
  const spend: SpendReport[] = [];
  let result: WeeklyOutcome;
  try {
    result = await runWeeklyDiscovery(supabase, user.id, {
      apiKey,
      fresh: true,
      deadline: Date.now() + DISCOVERY_BUDGET_MS,
      onSpend: (report) => spend.push(report),
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'The startup search failed.' };
  } finally {
    // A call that was made was paid for, whether or not the run finished.
    await recordSessionSpend(user.id, { module: 'jobs', operation: 'shortlist-startups' }, spend);
  }

  revalidatePath('/jobs/find');
  if (result.state === 'skipped') return { error: null, message: 'A startup search is already running. It will show here when it finishes.' };
  if (result.error) return { error: result.error };
  const kept = result.added + result.refreshed;
  return {
    error: null,
    message: `Dash kept ${kept} ${kept === 1 ? 'startup' : 'startups'}, ${result.added} of them new, and found ${result.boardsFound} more job ${result.boardsFound === 1 ? 'board' : 'boards'}.`,
  };
}

/**
 * Add to my companies, on a discovered company: it becomes a companies row
 * with its website and job board, so the roles search reads its board every
 * day as it does for any company followed, and the watchlist row points at it.
 */
// latency: pending
export async function addDiscoveredCompany(watchlistId: string): Promise<{ error: string | null }> {
  const id = z.string().uuid().safeParse(watchlistId);
  if (!id.success) return { error: 'That company could not be found.' };

  const user = await requireUser();
  const supabase = await createClient();
  const { data: row, error: readError } = await supabase
    .from('watchlist_startups')
    .select('name, website, board_vendor, board_token, company_id')
    .eq('id', id.data)
    .eq('user_id', user.id)
    .maybeSingle();
  if (readError || !row) return { error: readError?.message ?? 'That company is gone.' };
  if (row.company_id) return { error: null };

  const company = await ensureCompany(supabase, user.id, row.name as string, {
    website: (row.website as string | null) ?? null,
    boardToken: (row.board_token as string | null) ?? null,
    ats: (row.board_vendor as string | null) ?? null,
  });
  if (company.error) return { error: company.error };

  const { error } = await supabase
    .from('watchlist_startups')
    .update({ company_id: company.id })
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/jobs/find');
  revalidatePath('/jobs/companies');
  return { error: null };
}
