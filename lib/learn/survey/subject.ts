import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * The hidden subject that holds survey questions about one vault theme
 * (plan #840, decision #838).
 *
 * Practice Flow can ask about a theme you write about and have no track for.
 * Those questions go in a learn subject of their own, marked `survey`, linked
 * to the theme by `theme_id`, with one idea per question. The ideas, questions
 * and answers are the ordinary `concepts` and `probes` rows, so `recordProbe`
 * and `recordAnswer` write and grade them unchanged. What keeps the subject out
 * of sight is the flag: `loadSubjects` and every other list of tracks leave a
 * survey subject out.
 *
 * Starting a real track with the theme's name takes the subject over:
 * `findOrCreateSubject` finds it by name and clears the flag. So nothing that
 * writes survey questions should go through `findOrCreateSubject` or
 * `saveChain`; write the idea into the id this returns.
 */

export type SurveySubject = { id: string; created: boolean };

type SubjectRow = { id: string; survey: boolean };

function fail(action: string, error: { message: string }): Error {
  return new Error(`${action} failed: ${error.message}`);
}

async function subjectForTheme(
  supabase: LearnSupabaseClient,
  themeId: string,
): Promise<SubjectRow | null> {
  const { data, error } = await supabase
    .from('subjects')
    .select('id, survey')
    .eq('theme_id', themeId)
    .maybeSingle();
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Looking up the subject for that theme', error);
  return (data as SubjectRow | null) ?? null;
}

/**
 * The survey subject for `theme`, made the first time it is asked for.
 *
 * Null when the theme already has a real track: one made from it and taken
 * over, or one you named the same as the theme. A question about a tracked
 * theme belongs in the track, so the survey has nothing to write there.
 */
export async function surveySubjectForTheme(
  supabase: LearnSupabaseClient,
  userId: string,
  theme: { id: string; name: string },
): Promise<SurveySubject | null> {
  const linked = await subjectForTheme(supabase, theme.id);
  if (linked) return linked.survey ? { id: linked.id, created: false } : null;

  // Subject names are unique per account regardless of case, so a track with
  // the theme's name is the theme's track.
  const { data: named, error: nameError } = await supabase
    .from('subjects')
    .select('id')
    .ilike('name', theme.name)
    .maybeSingle();
  assertSchemaExposed(nameError, LEARN_SCHEMA);
  if (nameError) throw fail('Looking up a track with that name', nameError);
  if (named) return null;

  const { data: created, error } = await supabase
    .from('subjects')
    .insert({ user_id: userId, name: theme.name, survey: true, theme_id: theme.id })
    .select('id')
    .single();
  assertSchemaExposed(error, LEARN_SCHEMA);

  if (error?.code === '23505') {
    // Another request made it first, by theme or by name.
    const raced = await subjectForTheme(supabase, theme.id);
    return raced?.survey ? { id: raced.id, created: false } : null;
  }
  if (error || !created) throw fail('Making the survey subject', error ?? { message: 'no row' });
  return { id: (created as { id: string }).id, created: true };
}

/** Every survey subject's id, for the readers that count per track. */
export async function loadSurveySubjectIds(
  supabase: LearnSupabaseClient,
  userId?: string,
): Promise<Set<string>> {
  let query = supabase.from('subjects').select('id').eq('survey', true);
  if (userId) query = query.eq('user_id', userId);
  const { data, error } = await query;
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading the survey subjects', error);
  return new Set(((data ?? []) as { id: string }[]).map((row) => row.id));
}

async function subjectForAim(
  supabase: LearnSupabaseClient,
  userId: string,
  aimId: string,
): Promise<SubjectRow | null> {
  const { data, error } = await supabase
    .from('subjects')
    .select('id, survey')
    .eq('user_id', userId)
    .eq('aim_id', aimId)
    .maybeSingle();
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Looking up the subject for that goal', error);
  return (data as SubjectRow | null) ?? null;
}

/**
 * The hidden subject that holds Practice Flow questions about one learning
 * goal (plan #1384), made the first time it is asked for.
 *
 * The same arrangement as a vault theme's: a subject marked `survey`, linked
 * to the goal by `aim_id` (learn 0084), so no list of tracks shows it. Write
 * goal questions into the id this returns, never through `findOrCreateSubject`,
 * which would take the subject over as a track.
 *
 * Null when the goal already has a real track: this subject taken over, or a
 * track you named the same as the goal. A hidden subject of the same name
 * (a vault theme's, or a claimed article's) is linked to the goal and used,
 * since subject names are unique per account and it is about the same thing.
 */
export async function surveySubjectForAim(
  supabase: LearnSupabaseClient,
  userId: string,
  aim: { id: string; name: string },
): Promise<SurveySubject | null> {
  const linked = await subjectForAim(supabase, userId, aim.id);
  if (linked) return linked.survey ? { id: linked.id, created: false } : null;

  const { data: named, error: nameError } = await supabase
    .from('subjects')
    .select('id, survey, aim_id')
    .eq('user_id', userId)
    .ilike('name', aim.name)
    .maybeSingle();
  assertSchemaExposed(nameError, LEARN_SCHEMA);
  if (nameError) throw fail('Looking up a track with that name', nameError);
  if (named) {
    const row = named as SubjectRow & { aim_id: string | null };
    if (!row.survey || row.aim_id != null) return null;
    const { error: linkError } = await supabase
      .from('subjects')
      .update({ aim_id: aim.id })
      .eq('id', row.id);
    assertSchemaExposed(linkError, LEARN_SCHEMA);
    if (linkError?.code === '23505') {
      const raced = await subjectForAim(supabase, userId, aim.id);
      return raced?.survey ? { id: raced.id, created: false } : null;
    }
    if (linkError) throw fail('Linking the survey subject to that goal', linkError);
    return { id: row.id, created: false };
  }

  const { data: created, error } = await supabase
    .from('subjects')
    .insert({ user_id: userId, name: aim.name, survey: true, aim_id: aim.id })
    .select('id')
    .single();
  assertSchemaExposed(error, LEARN_SCHEMA);

  if (error?.code === '23505') {
    // Another request made it first, by goal or by name.
    const raced = await subjectForAim(supabase, userId, aim.id);
    return raced?.survey ? { id: raced.id, created: false } : null;
  }
  if (error || !created) throw fail('Making the survey subject', error ?? { message: 'no row' });
  return { id: (created as { id: string }).id, created: true };
}
