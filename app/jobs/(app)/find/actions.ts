'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { formatDate } from '@/lib/jobs/applications/load';
import { runWeeklyDiscovery, type WeeklyOutcome } from '@/lib/jobs/discover/weekly';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { ensureCompany } from '@/lib/jobs/companies/ensure';
import { SUGGEST_MODEL, suggestLearningTracks } from '@/lib/jobs/learning/suggest';
import { THOUGHT_MAX } from '@/lib/jobs/thoughts';
import { insertAim } from '@/lib/learn/aims-store';
import { placeAims } from '@/lib/learn/areas/place-aim';
import { createLearnClient } from '@/lib/learn/auth/server';
import { giveAimsTracks } from '@/lib/learn/lessons/aim-tracks';

export interface ThoughtState {
  error: string | null;
}

function check(body: string): string | null {
  if (!body.trim()) return 'Write something first.';
  if (body.length > THOUGHT_MAX) return `Keep an entry under ${THOUGHT_MAX.toLocaleString('en-GB')} characters.`;
  return null;
}

/** A new dated entry. Older ones stay as they were. */
// latency: pending
export async function addThought(_prev: ThoughtState, form: FormData): Promise<ThoughtState> {
  const body = String(form.get('body') ?? '');
  const invalid = check(body);
  if (invalid) return { error: invalid };

  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from('thoughts').insert({ user_id: user.id, body: body.trim() });
  if (error) return { error: error.message };

  revalidatePath('/jobs/find');
  return { error: null };
}

// latency: pending
export async function updateThought(id: string, body: string): Promise<{ error: string | null }> {
  const invalid = check(body);
  if (invalid) return { error: invalid };

  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from('thoughts')
    .update({ body: body.trim() })
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/jobs/find');
  return { error: null };
}

// latency: pending
export async function deleteThought(id: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from('thoughts').delete().eq('id', id).eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/jobs/find');
  return { error: null };
}

/**
 * Learning tracks for the career goals (job_search.learning_tracks, 0027).
 *
 * Suggest reads the entries and stores what Claude proposes. Start makes a
 * suggestion a Learn goal, which gives it a track with its first units after
 * the response, as adding a goal on Learn's Goals page does. Not now turns a
 * suggestion down, and it is not suggested again.
 */

export type TrackActionState = { error: string | null; message?: string };

const TrackId = z.string().uuid();

// latency: pending
export async function suggestTracks(): Promise<TrackActionState> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Suggestions are not configured.' };

  const user = await requireUser();
  const supabase = await createClient();
  const learn = await createLearnClient();

  const [thoughts, profile, suggested, aims, subjects] = await Promise.all([
    supabase
      .from('thoughts')
      .select('body, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase.from('profiles').select('timezone').eq('id', user.id).single(),
    supabase.from('learning_tracks').select('name, status').eq('user_id', user.id),
    learn.from('aims').select('name').is('archived_at', null),
    learn.from('subjects').select('name').eq('survey', false),
  ]);
  if (thoughts.error || suggested.error) return { error: 'Your career goals could not be read. Try again.' };
  const entries = (thoughts.data ?? []) as { body: string; created_at: string }[];
  if (entries.length === 0) return { error: 'Write a career goals entry first; the tracks come from it.' };

  const timezone = profile.data?.timezone ?? 'UTC';
  const rows = (suggested.data ?? []) as { name: string; status: string }[];
  const names = (result: { data: unknown }) => ((result.data ?? []) as { name: string }[]).map((row) => row.name);
  const have = [
    ...rows.filter((row) => row.status !== 'dismissed').map((row) => row.name),
    ...names(aims),
    ...names(subjects),
  ];
  const declined = rows.filter((row) => row.status === 'dismissed').map((row) => row.name);

  const spend: SpendReport[] = [];
  const result = await suggestLearningTracks(
    { apiKey, onSpend: (report) => spend.push(report) },
    {
      entries: entries.map((entry) => ({ written: formatDate(entry.created_at, timezone), body: entry.body })),
      have,
      declined,
    },
  );
  await recordSessionSpend(user.id, { module: 'jobs', operation: 'suggest-learning-tracks' }, spend);
  if (!result.ok) return { error: result.error };
  if (result.suggestions.length === 0) {
    return { error: null, message: 'Nothing new to suggest from what you have written so far.' };
  }

  // One insert each, so a name taken since the read (the unique index) skips
  // that suggestion rather than losing the rest.
  let added = 0;
  for (const suggestion of result.suggestions) {
    const { error } = await supabase.from('learning_tracks').insert({
      user_id: user.id,
      name: suggestion.name,
      about: suggestion.about,
      depth: suggestion.depth,
      why: suggestion.why,
      model: SUGGEST_MODEL,
    });
    if (!error) added += 1;
    else if (error.code !== '23505') console.error('[jobs learning tracks] insert', error.message);
  }

  revalidatePath('/jobs/find');
  if (added === 0) return { error: null, message: 'Nothing new to suggest from what you have written so far.' };
  return { error: null };
}

// latency: pending
export async function startTrack(id: string): Promise<TrackActionState> {
  const parsed = TrackId.safeParse(id);
  if (!parsed.success) return { error: 'Could not tell which track that was.' };

  const user = await requireUser();
  const supabase = await createClient();
  const { data: track, error: readError } = await supabase
    .from('learning_tracks')
    .select('name, about, depth, status')
    .eq('id', parsed.data)
    .eq('user_id', user.id)
    .maybeSingle();
  if (readError) return { error: 'The track could not be read. Try again.' };
  if (!track || track.status !== 'proposed') return { error: 'That suggestion has already been answered.' };

  const learn = await createLearnClient();
  let aimId: string;
  try {
    aimId = await insertAim(learn, user.id, {
      name: track.name as string,
      about: (track.about as string | null) ?? null,
      depth: track.depth as 'familiar' | 'solid' | 'deep',
    });
  } catch {
    return { error: 'The track could not be started. Try again.' };
  }

  const { error } = await supabase
    .from('learning_tracks')
    .update({ status: 'started', aim_id: aimId, decided_at: new Date().toISOString() })
    .eq('id', parsed.data)
    .eq('user_id', user.id);
  if (error) console.error('[jobs learning tracks] start', error.message);

  // Placed in the area grid, then given its track and first units, once the
  // response has gone, as a goal added to the Learn area on /goals is.
  after(async () => {
    await placeAims(learn, user.id);
    await giveAimsTracks(learn, user.id);
  });

  revalidatePath('/jobs/find');
  revalidatePath('/goals', 'layout');
  return { error: null };
}

// latency: pending
export async function dismissTrack(id: string): Promise<TrackActionState> {
  const parsed = TrackId.safeParse(id);
  if (!parsed.success) return { error: 'Could not tell which track that was.' };

  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from('learning_tracks')
    .update({ status: 'dismissed', decided_at: new Date().toISOString() })
    .eq('id', parsed.data)
    .eq('user_id', user.id)
    .eq('status', 'proposed');
  if (error) return { error: 'That could not be saved. Try again.' };

  revalidatePath('/jobs/find');
  return { error: null };
}

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
