import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  isTeachBackRate,
  keptCutoff,
  pickTeachBackIdea,
  repeatCutoff,
  TEACH_BACK_CONTEXT,
  TEACH_BACK_DEFAULT_EVERY,
  teachBackDue,
  teachBackPrompt,
  teachBackWhy,
  type KeptIdea,
  type Marking,
  type TeachBackState,
} from './teach-back';

/**
 * Reading and writing teach-backs (plan #1054). Every read and write names the
 * person, so these work through the service client from the top-up and
 * through the person's own session from the card's actions alike.
 */

/** How often the deck asks for a teach-back: one card in this many, 0 for never. */
export async function loadTeachBackEvery(learn: LearnSupabaseClient, userId: string): Promise<number> {
  const { data, error } = await learn
    .from('settings')
    .select('teach_back_every')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Reading your Learn settings failed: ${error.message}`);
  const every = (data as { teach_back_every: number } | null)?.teach_back_every;
  return typeof every === 'number' ? every : TEACH_BACK_DEFAULT_EVERY;
}

export async function saveTeachBackEvery(
  learn: LearnSupabaseClient,
  userId: string,
  every: number,
): Promise<void> {
  if (!isTeachBackRate(every)) throw new Error('That is not one of the choices.');
  const { error } = await learn
    .from('settings')
    .upsert(
      { user_id: userId, teach_back_every: every, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  if (error) throw new Error(`Saving that failed: ${error.message}`);
}

/** Statuses that mean the person kept the idea: known, work on this, saved. */
const KEPT_STATUSES = ['known', 'review', 'saved'];

/** The most kept cards read when choosing an idea. */
const KEPT_READ = 300;

export type TeachBackAdded = 'off' | 'not-due' | 'no-idea' | 'added';

/**
 * Put a teach-back into the deck when one is owed (`teachBackDue`), about the
 * idea `pickTeachBackIdea` chooses. No model call: the card is the idea's
 * name and a fixed question, and the marking is paid for when it is answered.
 * Called by the Learn now top-up for each person it runs for.
 */
export async function addTeachBackCard(
  learn: LearnSupabaseClient,
  userId: string,
  now: number = Date.now(),
): Promise<TeachBackAdded> {
  const every = await loadTeachBackEvery(learn, userId);
  if (every === 0) return 'off';

  const { data: lastRows, error: lastError } = await learn
    .from('feed_cards')
    .select('created_at, status, teach_back')
    .eq('user_id', userId)
    .eq('reason', 'teach_back')
    .order('created_at', { ascending: false })
    .limit(1);
  if (lastError) throw new Error(`Reading your last teach-back failed: ${lastError.message}`);
  const last = ((lastRows ?? []) as { created_at: string; status: string; teach_back: unknown }[])[0];

  let written = learn
    .from('feed_cards')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .neq('reason', 'teach_back')
    .not('written_at', 'is', null)
    .not('status', 'in', '(picked,dropped)');
  if (last) written = written.gt('written_at', last.created_at);
  const { count, error: countError } = await written;
  if (countError) throw new Error(`Counting your cards failed: ${countError.message}`);

  const waiting = Boolean(last && last.status === 'ready' && last.teach_back === null);
  if (!teachBackDue({ every, writtenSince: count ?? 0, waiting })) return 'not-due';

  const [keptRead, askedRead] = await Promise.all([
    learn
      .from('feed_cards')
      .select('concept_id, acted_at')
      .eq('user_id', userId)
      .neq('reason', 'teach_back')
      .not('concept_id', 'is', null)
      .in('status', KEPT_STATUSES)
      .lte('acted_at', keptCutoff(now))
      .order('acted_at', { ascending: true })
      .limit(KEPT_READ),
    learn
      .from('feed_cards')
      .select('concept_id')
      .eq('user_id', userId)
      .eq('reason', 'teach_back')
      .gte('created_at', repeatCutoff(now)),
  ]);
  if (keptRead.error) throw new Error(`Reading the ideas you kept failed: ${keptRead.error.message}`);
  if (askedRead.error) throw new Error(`Reading your teach-backs failed: ${askedRead.error.message}`);

  const seen = new Set<string>();
  const kept: KeptIdea[] = [];
  for (const row of (keptRead.data ?? []) as { concept_id: string; acted_at: string | null }[]) {
    if (!row.acted_at || seen.has(row.concept_id)) continue;
    seen.add(row.concept_id);
    kept.push({ conceptId: row.concept_id, actedAt: row.acted_at });
  }
  if (kept.length === 0) return 'no-idea';

  const { data: sharpRows, error: sharpError } = await learn
    .from('concept_state')
    .select('concept_id')
    .eq('user_id', userId)
    .eq('state', 'sharp')
    .in(
      'concept_id',
      kept.map((idea) => idea.conceptId),
    );
  if (sharpError) throw new Error(`Reading what you know failed: ${sharpError.message}`);

  const idea = pickTeachBackIdea(
    kept,
    {
      askedRecently: new Set(((askedRead.data ?? []) as { concept_id: string }[]).map((row) => row.concept_id)),
      sharp: new Set(((sharpRows ?? []) as { concept_id: string }[]).map((row) => row.concept_id)),
    },
    now,
  );
  if (!idea) return 'no-idea';

  const { data: concept, error: conceptError } = await learn
    .from('concepts')
    .select('name, claim')
    .eq('id', idea.conceptId)
    .eq('user_id', userId)
    .maybeSingle();
  if (conceptError) throw new Error(`Reading the idea failed: ${conceptError.message}`);
  if (!concept) return 'no-idea';
  const { name, claim } = concept as { name: string; claim: string };

  const { error: insertError } = await learn.from('feed_cards').insert({
    user_id: userId,
    reason: 'teach_back',
    status: 'ready',
    concept_id: idea.conceptId,
    idea_name: name,
    why: teachBackWhy(idea.actedAt),
    context: TEACH_BACK_CONTEXT,
    hook: teachBackPrompt(name),
    // The answer, kept for the end of the exchange; the page shows it only then.
    summary: claim,
    written_at: new Date(now).toISOString(),
  });
  if (insertError) throw new Error(`Adding the teach-back failed: ${insertError.message}`);
  return 'added';
}

/**
 * Keep one marked answer as a question at the defence rung, which is what
 * the idea's own page lists under "Questions asked".
 */
export async function recordTeachBackProbe(
  learn: LearnSupabaseClient,
  userId: string,
  input: {
    conceptId: string;
    question: string;
    expected: string;
    response: string;
    marking: Marking;
    model: string;
  },
): Promise<void> {
  const { error } = await learn.from('probes').insert({
    user_id: userId,
    concept_id: input.conceptId,
    rung: 'defend',
    question: input.question,
    expected: input.expected,
    response: input.response,
    response_correct: input.marking.holds,
    grade_reason: input.marking.why,
    answered_at: new Date().toISOString(),
    model: input.model,
  });
  if (error) throw new Error(`Keeping the answer failed: ${error.message}`);
}

/** Set the idea's state from the teach-back, as a tested answer sets it. */
export async function settleTeachBackState(
  learn: LearnSupabaseClient,
  userId: string,
  conceptId: string,
  state: TeachBackState,
): Promise<void> {
  const { error } = await learn.from('concept_state').upsert(
    {
      concept_id: conceptId,
      user_id: userId,
      state,
      established: 'tested',
      misconception: null,
      tested_at: new Date().toISOString(),
      declared_at: null,
    },
    { onConflict: 'concept_id' },
  );
  if (error) throw new Error(`Recording what that showed failed: ${error.message}`);
}
