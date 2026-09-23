import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { Probe } from '@/lib/learn/graph/probe-payload';
import { joinCase, type AppliedCase } from '@/lib/learn/graph/applied-payload';
import {
  barPercent,
  standingOf,
  wasAnswered,
  wasRight,
  weightFor,
  type AskedRung,
  type Rung,
} from '@/lib/learn/graph/probe-payload';
import { inferredFrom, type Concept, type Graph, type KnowledgeState } from '@/lib/learn/graph/model';
import { conceptToRecheck, isRecheckTurn } from '@/lib/learn/graph/recheck';

/**
 * A probe session: what to ask about next, and what an answer settles.
 *
 * The evidence trail is kept in full rather than collapsed into a score. Every
 * question asked keeps its options as asked, the index chosen, and the weight
 * it earned, which is what makes "you have been wrong about this three times
 * in four months" answerable later and what any re-probing schedule would
 * read. A score would answer none of that and cannot be un-collapsed.
 *
 * All the state is here, in Postgres. Nothing carries a session in a
 * conversation, which is the difference between a session costing twenty cents
 * and costing ten dollars.
 */

export type ProbeRow = {
  id: string;
  conceptId: string;
  /** On an applied row this is the case: the situation, then what to say. */
  question: string;
  /** Null on a written row, which has nothing to pick from. */
  options: string[] | null;
  correctIndex: number | null;
  reason: string | null;
  chosenIndex: number | null;
  /** Answered by saying you did not know, with nothing picked. Recognise only. */
  dontKnow?: boolean;
  /** The answer the writer expected. Written rungs only. */
  expected: string | null;
  /** What was typed. Null until a written question is answered. */
  response: string | null;
  /** Whether what was typed held the idea. Null until it is graded. */
  responseCorrect: boolean | null;
  /** The grader's one sentence on why. */
  gradeReason: string | null;
  /** Which rung it was asked at. Everything asked before the ladder is recognise. */
  rung: Rung;
  weight: number;
  /** The check it was written against, or null for a concept with none. */
  masteryCheck: string | null;
  /**
   * When the question was written. Read against the concept's
   * `claimRewrittenAt` to say whether it was asked about the wording that is
   * there now -- which is what #382 settled, and it needs no write of its own.
   */
  askedAt: string;
};

function fail(action: string, error: { message: string }): Error {
  return new Error(`${action} failed: ${error.message}`);
}

/**
 * What this session has asked so far, and what it was worth.
 *
 * Read back rather than carried, so a session survives a closed tab: the bar
 * is a fact about the rows, not about a variable somebody is holding.
 */
export async function answeredWeight(
  supabase: LearnSupabaseClient,
  conceptIds: string[],
): Promise<number> {
  if (conceptIds.length === 0) return 0;

  const { data, error } = await supabase
    .from('probes')
    .select('weight')
    .in('concept_id', conceptIds)
    .not('answered_at', 'is', null);

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading what you have answered', error);

  return ((data ?? []) as { weight: number | string }[]).reduce(
    (total, row) => total + Number(row.weight),
    0,
  );
}

/**
 * How many questions have actually been answered.
 *
 * The cadence a re-check runs on is counted from this rather than from a
 * counter held somewhere: each question is picked fresh, so the only record of
 * how many have gone by is the rows themselves. `conceptIds` narrows it to one
 * subject; left out, it counts the account's answers across every subject.
 */
export async function answeredCount(
  supabase: LearnSupabaseClient,
  conceptIds?: string[],
): Promise<number> {
  if (conceptIds !== undefined && conceptIds.length === 0) return 0;

  let query = supabase
    .from('probes')
    .select('id', { count: 'exact', head: true })
    .not('answered_at', 'is', null);
  if (conceptIds !== undefined) query = query.in('concept_id', conceptIds);

  const { count, error } = await query;

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Counting what you have answered', error);

  return count ?? 0;
}

/** The bar, from the rows. */
export async function subjectBarPercent(
  supabase: LearnSupabaseClient,
  conceptIds: string[],
): Promise<number> {
  return barPercent(await answeredWeight(supabase, conceptIds));
}

/**
 * When the newest answered question was answered, across every subject.
 *
 * One row, ordered by the column that is null until an answer lands, so an
 * asked-and-abandoned question does not count as a session. RLS scopes it to
 * the account, the same as every other read here.
 */
export async function lastAnsweredAt(supabase: LearnSupabaseClient): Promise<string | null> {
  const { data, error } = await supabase
    .from('probes')
    .select('answered_at')
    .not('answered_at', 'is', null)
    .order('answered_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading when you last answered one', error);

  return data ? (data as { answered_at: string }).answered_at : null;
}

/** Everything asked about one concept, newest first. */
export async function probesFor(
  supabase: LearnSupabaseClient,
  conceptId: string,
): Promise<ProbeRow[]> {
  const { data, error } = await supabase
    .from('probes')
    .select(
      'id, concept_id, question, options, correct_index, reason, chosen_index, dont_know, ' +
        'expected, response, response_correct, grade_reason, rung, weight, mastery_check, ' +
        'created_at',
    )
    .eq('concept_id', conceptId)
    // Not a question Practice Flow has written ahead and not yet shown. It
    // has not been asked, and listing it would put a question and its answer
    // on the claim's page before the flow gets to it.
    .or('picked_state.is.null,shown_at.not.is.null')
    .order('created_at', { ascending: false });

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading the questions asked', error);

  return ((data ?? []) as unknown as {
    id: string;
    concept_id: string;
    question: string;
    options: string[] | null;
    correct_index: number | null;
    reason: string | null;
    chosen_index: number | null;
    dont_know: boolean;
    expected: string | null;
    response: string | null;
    response_correct: boolean | null;
    grade_reason: string | null;
    rung: Rung;
    weight: number | string;
    mastery_check: string | null;
    created_at: string;
  }[]).map((row) => ({
    id: row.id,
    conceptId: row.concept_id,
    question: row.question,
    options: row.options,
    correctIndex: row.correct_index,
    reason: row.reason,
    chosenIndex: row.chosen_index,
    dontKnow: row.dont_know,
    expected: row.expected,
    response: row.response,
    responseCorrect: row.response_correct,
    gradeReason: row.grade_reason,
    rung: row.rung,
    weight: Number(row.weight),
    masteryCheck: row.mastery_check,
    askedAt: row.created_at,
  }));
}

/**
 * Which concept to ask about next.
 *
 * Unsettled first, and among those the ones with something already known about
 * them -- shaky and misconception -- before the ones nothing has been found
 * out about, because a claim you have already got wrong is where the next
 * question is worth most. A settled node is only revisited when there is
 * nothing else left, and then it is worth a fraction of the information.
 *
 * Inside each of those bands the doors come first. What sits downstream of a
 * door does not land until you are through it, so finding out where you stand
 * on the door tells you more than the same question about one of its
 * consequences -- and if the door turns out to be a misconception, half the
 * answers below it were going to be wrong for the same reason.
 *
 * `recheck` is the exception to all of that, and the same cadence the
 * five-minute screen runs on: on every fifth question the claim in this subject
 * you were asked about longest ago takes the turn, so old ground comes round
 * without waiting for the frontier to run out. Nothing old enough, or no
 * cadence passed, and the bands decide as before.
 */
export function nextConcept(
  concepts: Concept[],
  askedCounts: Map<string, number>,
  recheck?: { answered: number; now: Date },
): Concept | null {
  if (recheck && isRecheckTurn(recheck.answered)) {
    const old = conceptToRecheck(concepts, recheck.now);
    if (old) return old;
  }

  const rank = (concept: Concept): number => {
    if (concept.state === 'misconception') return 0;
    if (concept.state === 'shaky') return 1;
    if (concept.state === 'unknown') return 2;
    // Recognised sits between the two: something has been shown about it, and
    // its applied case is still waiting, so it comes before the claims that
    // have nothing left to ask.
    if (concept.state === 'recognised') return 3;
    return 4;
  };

  // A door before anything else in the same band. An unmarked concept ranks
  // with the consequences rather than below them: nobody has judged it, and
  // putting it last would be a judgement -- the same reason the column is left
  // null for everything that was in a graph before the marks existed.
  const doorRank = (concept: Concept): number => (concept.kind === 'threshold' ? 0 : 1);

  const sorted = [...concepts].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    const byDoor = doorRank(a) - doorRank(b);
    if (byDoor !== 0) return byDoor;
    // Then whichever has been asked about least, so a session spreads out
    // rather than circling one node.
    const byAsked = (askedCounts.get(a.id) ?? 0) - (askedCounts.get(b.id) ?? 0);
    if (byAsked !== 0) return byAsked;
    return a.name.localeCompare(b.name);
  });

  return sorted[0] ?? null;
}

/**
 * Which of a concept's checks the next question is for.
 *
 * The one asked about least, and among equals the one written first. So the
 * first question about a concept with three checks takes the first of them,
 * the second question takes the second, and a concept only gets a second
 * question about the same check once every check has had one -- which is the
 * point of having them: a second question about the same idea that repeats the
 * same check is the same information asked twice.
 *
 * Asked rather than answered, because a question abandoned half way has still
 * been put, and putting it again would be the same question.
 *
 * Null for a concept with no checks. That concept is probed against its claim
 * in general, exactly as everything was before the checks existed.
 */
export function nextMasteryCheck(
  mastery: readonly string[],
  /** What the questions already asked about this concept were aimed at. */
  asked: readonly (string | null)[],
): string | null {
  if (mastery.length === 0) return null;

  const counts = new Map<string, number>();
  for (const check of asked) {
    if (check === null) continue;
    counts.set(check, (counts.get(check) ?? 0) + 1);
  }

  let chosen = mastery[0];
  let fewest = counts.get(chosen) ?? 0;
  for (const check of mastery.slice(1)) {
    const count = counts.get(check) ?? 0;
    if (count < fewest) {
      chosen = check;
      fewest = count;
    }
  }

  return chosen;
}

/**
 * The rungs and the shape of a question already asked, from the pure half.
 *
 * Re-exported rather than moved back: `standingOf` reads both, and it lives
 * beside the bar rules in probe-payload.ts where there is no client to drag in.
 */
export type { AskedRung, Rung };

/**
 * Which check the applied case is aimed at.
 *
 * The one answered wrong most often, and among equals the one written first.
 * #391 settled that a concept gets one applied case rather than one per check,
 * aimed at whichever check the multiple-choice answers left weakest, and the
 * number of times a check was missed on the way to being got right is what
 * "weakest" can be read off. A concept nothing was ever missed about takes its
 * first check, since no answer distinguishes them. Misses at every rung count,
 * so a second case follows the one that was just failed rather than moving on.
 */
function weakestCheck(mastery: readonly string[], earlier: readonly AskedRung[]): string | null {
  if (mastery.length === 0) return null;

  const missed = new Map<string, number>();
  for (const probe of earlier) {
    if (probe.masteryCheck === null || !wasAnswered(probe) || wasRight(probe)) continue;
    missed.set(probe.masteryCheck, (missed.get(probe.masteryCheck) ?? 0) + 1);
  }

  let chosen = mastery[0];
  let most = missed.get(chosen) ?? 0;
  for (const check of mastery.slice(1)) {
    const count = missed.get(check) ?? 0;
    if (count > most) {
      chosen = check;
      most = count;
    }
  }

  return chosen;
}

/**
 * Which rung the next question about one concept is asked at, and what it is
 * aimed at.
 *
 * Multiple choice until every check of understanding has been got right at
 * least once, working through the checks the way it always has, and an applied
 * case from then on. Getting one check right does not move the concept up:
 * recognising the idea in one place and not another is the gap the rung is
 * there to find.
 *
 * Read from the answers rather than from the questions, which is the one place
 * this differs from `nextMasteryCheck`: a question put and abandoned has still
 * been asked, so it is not put again, but it settled nothing and cannot move a
 * concept up a rung.
 *
 * A concept with no checks has nothing to work through, so one right answer
 * moves it up, and its applied case is written against the claim itself.
 *
 * Once an applied case has been got right the picker stays on `apply`: the
 * rung above it is the defence, which is not built. A concept that comes round
 * again after passing gets another case rather than dropping back to the
 * questions it has already answered.
 */
export function nextRung(
  mastery: readonly string[],
  /** Every question already asked about this concept, answered or not. */
  earlier: readonly AskedRung[],
): { rung: Rung; check: string | null } {
  const recognise = earlier.filter((probe) => probe.rung === 'recognise');

  const passed =
    mastery.length === 0
      ? recognise.some(wasRight)
      : mastery.every((check) => standingOf(check, 'recognise', earlier) === 'right');

  if (!passed) {
    return {
      rung: 'recognise',
      check: nextMasteryCheck(
        mastery,
        recognise.map((probe) => probe.masteryCheck),
      ),
    };
  }

  return { rung: 'apply', check: weakestCheck(mastery, earlier) };
}

/**
 * Mark a concept as carrying a named misconception.
 *
 * The state and the sentence are one fact -- the database refuses one without
 * the other -- because a misconception nobody can read is indistinguishable
 * from a gap, and the whole point of the state is that it is not one.
 */
export async function setMisconception(
  supabase: LearnSupabaseClient,
  userId: string,
  conceptId: string,
  misconception: string,
): Promise<void> {
  const { error } = await supabase.from('concept_state').upsert(
    {
      concept_id: conceptId,
      user_id: userId,
      state: 'misconception',
      established: 'tested',
      misconception,
      tested_at: new Date().toISOString(),
      // A question was answered about this, so whatever was claimed on your
      // word about it is superseded. The row holds one date or the other.
      declared_at: null,
    },
    { onConflict: 'concept_id' },
  );

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Naming what you mixed up', error);
}

/** Write a question as asked, before it is answered. */
export async function recordProbe(
  supabase: LearnSupabaseClient,
  userId: string,
  input: {
    conceptId: string;
    probe: Probe;
    model: string;
    /**
     * Set by Practice Flow, which records what the pick was so it can tell
     * later whether the pick still holds. `shownAt` is left out for a question
     * written ahead, which waits in the queue until it is shown.
     */
    flow?: {
      pickedState: KnowledgeState;
      pickedRecheck: 'tested' | 'declared' | null;
      shownAt: string | null;
    };
  },
): Promise<string> {
  const { data, error } = await supabase
    .from('probes')
    .insert({
      ...(input.flow && {
        picked_state: input.flow.pickedState,
        picked_recheck: input.flow.pickedRecheck,
        shown_at: input.flow.shownAt,
      }),
      user_id: userId,
      concept_id: input.conceptId,
      question: input.probe.question,
      // As asked, verbatim. A stored index means nothing a month later if the
      // options were regenerated in the meantime.
      options: input.probe.options,
      correct_index: input.probe.correctIndex,
      reason: input.probe.reason,
      // The check it was aimed at, stored as the text it was at the time, for
      // the same reason the options are: the list on the concept can change.
      mastery_check: input.probe.masteryCheck,
      model: input.model,
    })
    .select('id')
    .single();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error || !data) throw fail('Saving the question', error ?? { message: 'no row' });
  return (data as { id: string }).id;
}

/**
 * Write an applied case as asked, before it is shown.
 *
 * The situation and what to say about it are stored in the question column as
 * one piece of text, joined the way `joinCase` joins them: a probe row holds
 * one question, and an applied case is that question in two parts rather than
 * a different kind of row.
 *
 * `expected` goes in here, with the case, and is shown only once the answer
 * has been typed -- the same rule the multiple-choice reason follows, and what
 * stops it being an explanation of whatever somebody happened to write.
 */
export async function recordAppliedCase(
  supabase: LearnSupabaseClient,
  userId: string,
  input: { conceptId: string; case: AppliedCase; model: string },
): Promise<string> {
  const { data, error } = await supabase
    .from('probes')
    .insert({
      user_id: userId,
      concept_id: input.conceptId,
      rung: 'apply',
      question: joinCase(input.case.situation, input.case.question),
      expected: input.case.expected,
      mastery_check: input.case.masteryCheck,
      model: input.model,
    })
    .select('id')
    .single();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error || !data) throw fail('Saving the case', error ?? { message: 'no row' });
  return (data as { id: string }).id;
}

export type AnswerOutcome = {
  correct: boolean;
  reason: string;
  weight: number;
  /** Where the answer left the concept. Which rung it came from decides. */
  state: SettledState;
  /** How many nodes underneath were marked known by inference. */
  inferred: number;
  /**
   * Whether this was the first answer to this question. False when the row had
   * already been answered, which earns no weight and is not a second thing
   * done about the claim either.
   */
  first: boolean;
};

/**
 * Mark what a correct answer implies, weakly.
 *
 * Written as `inferred` rather than `tested`, and only over nodes nobody has
 * answered about, which is what the rule in model.ts already worked out. The
 * upsert ignores conflicts rather than overwriting: a row that appeared
 * between the read and this write belongs to an answer, and an answer beats an
 * inference every time.
 *
 * The state is whatever the answer above earned, never more. A right
 * multiple-choice answer implies you recognise what it rests on; it cannot
 * imply you could use them, which is the thing #401 stopped a picked answer
 * from claiming about the concept it was actually asked about.
 */
async function markInferred(
  supabase: LearnSupabaseClient,
  userId: string,
  state: SettledState,
  conceptIds: string[],
): Promise<number> {
  if (conceptIds.length === 0) return 0;

  const { error } = await supabase.from('concept_state').upsert(
    conceptIds.map((conceptId) => ({
      concept_id: conceptId,
      user_id: userId,
      state,
      established: 'inferred',
      misconception: null,
    })),
    { onConflict: 'concept_id', ignoreDuplicates: true },
  );

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Recording what that implied', error);
  return conceptIds.length;
}

/**
 * Record an answer, and move the concept with it.
 *
 * Right settles the node, wrong makes it shaky, and both record that they were
 * established by testing rather than inferred -- which is the distinction the
 * state and its basis are two columns for. A correct answer also settles what
 * the node rests on, weakly and never over an answer somebody gave.
 *
 * What a repeated wrong answer means -- the same option twice becoming a named
 * misconception -- is handled beside this rather than in it, because it costs a
 * model call and this must not.
 */
export async function recordAnswer(
  supabase: LearnSupabaseClient,
  userId: string,
  input: {
    probeId: string;
    conceptId: string;
    chosenIndex: number;
    /**
     * Whether the concept was already settled. Read only for a question
     * written against no check, since a concept that carries checks is weighed
     * by what earlier answers did with the one this question aimed at.
     */
    wasSettled: boolean;
    /** The subject's graph, so a correct answer can settle what is under it. */
    graph?: Graph;
  },
): Promise<AnswerOutcome> {
  const { data, error } = await supabase
    .from('probes')
    .select('correct_index, reason, chosen_index, dont_know, mastery_check')
    .eq('id', input.probeId)
    .maybeSingle();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading the question', error);
  if (!data) throw new Error('That question is not there any more.');

  const probe = data as {
    correct_index: number;
    reason: string;
    chosen_index: number | null;
    dont_know: boolean;
    mastery_check: string | null;
  };
  // Said you did not know it already: the answer is on the screen, and a pick
  // made after reading it is not an answer.
  if (probe.dont_know) throw new Error('You already said you did not know this one.');
  const correct = probe.correct_index === input.chosenIndex;

  // Where the check this question aimed at stood before the answer, from the
  // other questions asked about the same concept: they carry the check they
  // were written against, what was picked and what was right. Null for a
  // question written against no check, which is weighed the older way.
  const standing =
    probe.mastery_check === null
      ? null
      : standingOf(
          probe.mastery_check,
          'recognise',
          (await probesFor(supabase, input.conceptId)).filter((row) => row.id !== input.probeId),
        );

  // Answering the same row twice earns nothing. The first answer is the one
  // that carried information; a second is a person clicking again.
  const first = probe.chosen_index === null;
  const weight = first
    ? weightFor({ conclusive: true, correct, standing, wasSettled: input.wasSettled })
    : 0;

  const { error: answerError } = await supabase
    .from('probes')
    .update({
      chosen_index: input.chosenIndex,
      answered_at: new Date().toISOString(),
      weight,
    })
    .eq('id', input.probeId);

  assertSchemaExposed(answerError, LEARN_SCHEMA);
  if (answerError) throw fail('Saving the answer', answerError);

  const { state, inferred } = await settleConcept(supabase, userId, {
    conceptId: input.conceptId,
    rung: 'recognise',
    correct,
    graph: input.graph,
  });

  return { correct, reason: probe.reason ?? '', weight, state, inferred, first };
}

/**
 * Record "I don't know" on a multiple-choice question (note a62b132f, A).
 *
 * A miss with nothing picked: weighed and settled exactly as a wrong pick is,
 * so the concept goes shaky, but no option is stored, so a repeated "don't
 * know" can never be read as the same wrong answer twice and named as a
 * misconception. Pressing it again earns nothing, the same as picking twice.
 */
export async function recordDontKnow(
  supabase: LearnSupabaseClient,
  userId: string,
  input: { probeId: string; conceptId: string; wasSettled: boolean },
): Promise<AnswerOutcome> {
  const { data, error } = await supabase
    .from('probes')
    .select('reason, chosen_index, dont_know, mastery_check')
    .eq('id', input.probeId)
    .maybeSingle();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading the question', error);
  if (!data) throw new Error('That question is not there any more.');

  const probe = data as {
    reason: string | null;
    chosen_index: number | null;
    dont_know: boolean;
    mastery_check: string | null;
  };
  if (probe.chosen_index !== null) throw new Error('This one is already answered.');

  const first = !probe.dont_know;
  const standing =
    probe.mastery_check === null
      ? null
      : standingOf(
          probe.mastery_check,
          'recognise',
          (await probesFor(supabase, input.conceptId)).filter((row) => row.id !== input.probeId),
        );
  const weight = first
    ? weightFor({ conclusive: true, correct: false, standing, wasSettled: input.wasSettled })
    : 0;

  if (first) {
    const { error: answerError } = await supabase
      .from('probes')
      .update({ dont_know: true, answered_at: new Date().toISOString(), weight })
      .eq('id', input.probeId);

    assertSchemaExposed(answerError, LEARN_SCHEMA);
    if (answerError) throw fail('Saving the answer', answerError);
  }

  const { state, inferred } = await settleConcept(supabase, userId, {
    conceptId: input.conceptId,
    rung: 'recognise',
    correct: false,
  });

  return { correct: false, reason: probe.reason ?? '', weight, state, inferred, first };
}

/** What an answer can leave a concept in. Never `unknown` or `misconception`. */
export type SettledState = 'recognised' | 'known' | 'sharp' | 'shaky';

/**
 * What a right answer at each rung says about the concept.
 *
 * The ladder, in one place. Picking the idea out of four means you recognise
 * it, using it in a case you have not seen means you know it, and holding it
 * against the strongest objection means it is sharp. `defend` is here because
 * the mapping is the whole rule and splitting it across two steps would leave
 * a rung with nowhere to land; nothing writes a defence question yet.
 */
const STATE_FOR_RUNG: Record<Rung, SettledState> = {
  recognise: 'recognised',
  apply: 'known',
  defend: 'sharp',
};

/**
 * Where one answer leaves the concept it was about.
 *
 * Pure and exported so the rule can be read and tested without a database; the
 * write around it is the part that needs one.
 */
export function settledStateFor(rung: Rung, correct: boolean): SettledState {
  return correct ? STATE_FOR_RUNG[rung] : 'shaky';
}

/**
 * Where an answer leaves the concept, and what it implies underneath.
 *
 * Wrong makes it shaky whatever rung it came from -- a miss is a miss -- and
 * right moves it to what that rung can show, which is #401: a picked answer
 * stops meaning known, and the applied case starts meaning it. Both say they
 * were established by testing, which is the claim the basis column carries.
 */
async function settleConcept(
  supabase: LearnSupabaseClient,
  userId: string,
  input: { conceptId: string; rung: Rung; correct: boolean; graph?: Graph },
): Promise<{ state: SettledState; inferred: number }> {
  const state = settledStateFor(input.rung, input.correct);
  const { error } = await supabase.from('concept_state').upsert(
    {
      concept_id: input.conceptId,
      user_id: userId,
      state,
      established: 'tested',
      // Cleared on any tested answer: a misconception is named by the next
      // slice from a repeated wrong option, and carrying an old one through a
      // correct answer would be the screen saying something untrue.
      misconception: null,
      tested_at: new Date().toISOString(),
      // Cleared for the same reason: the claim now rests on an answer rather
      // than on your word, and the row is allowed only one of the two dates.
      declared_at: null,
    },
    { onConflict: 'concept_id' },
  );

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Recording what that answer showed', error);

  // Growth trigger 3: answering correctly about a node says the things it
  // rests on are probably in place. Weakly, and never over an answer somebody
  // actually gave -- inferredFrom already refuses those.
  const inferred =
    input.correct && input.graph
      ? await markInferred(supabase, userId, state, inferredFrom(input.graph, input.conceptId))
      : 0;

  return { state, inferred };
}

/**
 * Record a typed answer and the grade it was given.
 *
 * The written half of `recordAnswer`: the grading happens outside, because it
 * costs a model call, and what lands here is the verdict and the sentence
 * behind it. Both go on the question rather than on the concept, so a page
 * reading the history a month later has what was typed, what was expected and
 * why it was marked as it was.
 *
 * The weight is the one the multiple-choice rule already gives, read at the
 * rung this row was asked at. An applied case is only reached once the check it
 * aims at has been got right at rung one, so keying the standing on the check
 * alone made the first case about it look like a repeat; keyed on the rung too
 * it is the new information it is, and worth the full amount.
 */
export async function recordWrittenAnswer(
  supabase: LearnSupabaseClient,
  userId: string,
  input: {
    probeId: string;
    conceptId: string;
    /** What was typed, as typed. */
    response: string;
    /** The grader's verdict, and the sentence it wrote first. */
    correct: boolean;
    why: string;
    /** Read only for a concept with no checks, the same as a picked answer. */
    wasSettled: boolean;
    graph?: Graph;
  },
): Promise<AnswerOutcome> {
  const { data, error } = await supabase
    .from('probes')
    .select('response, mastery_check, rung')
    .eq('id', input.probeId)
    .maybeSingle();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading the case', error);
  if (!data) throw new Error('That question is not there any more.');

  // The rung comes off the row rather than from the caller, the same as which
  // columns carry the answer: the row is what decides what this question was.
  const probe = data as { response: string | null; mastery_check: string | null; rung: Rung };

  const standing =
    probe.mastery_check === null
      ? null
      : standingOf(
          probe.mastery_check,
          probe.rung,
          (await probesFor(supabase, input.conceptId)).filter((row) => row.id !== input.probeId),
        );

  // Answering the same case twice earns nothing, the same as picking twice.
  const first = probe.response === null;
  const weight = first
    ? weightFor({ conclusive: true, correct: input.correct, standing, wasSettled: input.wasSettled })
    : 0;

  const { error: answerError } = await supabase
    .from('probes')
    .update({
      response: input.response,
      response_correct: input.correct,
      grade_reason: input.why,
      answered_at: new Date().toISOString(),
      weight,
    })
    .eq('id', input.probeId);

  assertSchemaExposed(answerError, LEARN_SCHEMA);
  if (answerError) throw fail('Saving the answer', answerError);

  const { state, inferred } = await settleConcept(supabase, userId, {
    conceptId: input.conceptId,
    rung: probe.rung,
    correct: input.correct,
    graph: input.graph,
  });

  return { correct: input.correct, reason: input.why, weight, state, inferred, first };
}
