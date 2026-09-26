'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { formatDate } from '@/lib/jobs/applications/load';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
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

  revalidatePath('/jobs/thoughts');
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

  revalidatePath('/jobs/thoughts');
  return { error: null };
}

// latency: pending
export async function deleteThought(id: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from('thoughts').delete().eq('id', id).eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/jobs/thoughts');
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

  revalidatePath('/jobs/thoughts');
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
  // response has gone, as a goal added on Learn's Goals page is.
  after(async () => {
    await placeAims(learn, user.id);
    await giveAimsTracks(learn, user.id);
  });

  revalidatePath('/jobs/thoughts');
  revalidatePath('/learn/goals');
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

  revalidatePath('/jobs/thoughts');
  return { error: null };
}
