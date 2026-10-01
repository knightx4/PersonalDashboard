import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { loadConcept, loadReadyAndSettled, loadSubjects } from '@/lib/learn/graph/load';
import type { KnowledgeState } from '@/lib/learn/graph/model';
import { pickAhead, pickOneToAsk, type NothingToAsk, type PickedToAsk } from '@/lib/learn/graph/pick';
import { READY_LIMIT } from '@/lib/learn/graph/ready';
import { PROBE_MODEL, writeProbe } from '@/lib/learn/graph/probe';
import { answeredCount, nextMasteryCheck, probesFor, recordProbe } from '@/lib/learn/graph/session';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { loadSurveyPool } from '@/lib/learn/survey/load';
import type { SurveyPool } from '@/lib/learn/survey/pick';
import { writeGoalQuestion, type GoalAim } from '@/lib/learn/survey/goal-question';
import { writeLevel3Question } from '@/lib/learn/survey/level3-question';
import { loadGoalsInTurn } from '@/lib/learn/survey/goal-turns';
import { writeSurveyQuestion } from '@/lib/learn/survey/question';
import {
  fieldsWrittenAbout,
  FLOW_LOOKBACK,
  flowSlots,
  GOAL_SHARE,
  surveyShare,
  type FlowTurn,
} from '@/lib/learn/survey/rate';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import type { TrackShare } from './interest';
import { loadTrackInterest, sharesFrom } from './interest-load';

/**
 * Practice Flow's questions, written before they are needed (plan #771).
 *
 * The flow keeps `WRITE_AHEAD` questions waiting as unanswered `learn.probes`
 * rows, so Next takes one off the queue instead of waiting on a model call.
 * The queue is topped up after each answer and each Next, from `after()`, so
 * the response is back before any writing starts.
 *
 * A waiting question belongs to the pick it came from, and the pick holds only
 * while the claim is in the state it was in then. Before a question is shown
 * the claim's state is read again, and a question whose claim has moved is
 * thrown away unshown (`discarded_at`) rather than asked.
 *
 * A flow can be focused on one track (plan #779): `track` is that subject's
 * id, and null asks across all of them. Focused, only that subject's waiting
 * questions are taken and only that subject is picked from when writing. The
 * queue itself stays one queue, so questions written for other tracks wait
 * there untouched until the flow mixes again.
 *
 * Mixed, the picks share questions between tracks by how much you engage with
 * each (plan #780, `interest.ts`), so every track's ready ideas are read
 * rather than only the top few across all of them.
 *
 * Mixed with no filter, the queue also holds survey questions about vault
 * subjects that are not tracks (plan #842), at the rate `survey/rate.ts` works
 * out. They are written ahead like the others. `tracksOnly` leaves them out,
 * and so does a flow focused on one track. A survey question waiting in the
 * queue is left there by those two, the same as another track's question.
 *
 * The same flows also ask about your open learning goals (plan #1385): one
 * question in three while you have one, worked out before the theme turn by
 * `flowSlots`. A goal question goes in the goal's hidden survey subject, so the
 * readers here tell it apart by the subject's `aim_id`, and name it after the
 * goal. A waiting question about a goal archived since is thrown away unshown.
 * The Level 3 goal takes its turns too, with questions about the articles you
 * claimed and have not been tested on (plan #1386).
 */

/**
 * Which questions the flow asks. `track` focuses it on one track (plan #779);
 * with none, `tracksOnly` asks across your tracks and nothing else, and
 * without it the survey is mixed in.
 */
export type FlowScope = { track: string | null; tracksOnly?: boolean };

/** Whether the flow mixes in survey and goal questions. */
function surveys(scope: FlowScope): boolean {
  return scope.track === null && !scope.tracksOnly;
}

/** How many questions the flow keeps written ahead. */
export const WRITE_AHEAD = 3;

/**
 * How long a question on the screen and not yet answered is shown again when
 * the page is opened, instead of a new one. Long enough to cover a reload or
 * coming back after lunch; after that it is left as a question you walked
 * away from, the same as one in a subject session.
 */
const RESUME_HOURS = 12;

/** One question, with what the screen says above it. */
export type FlowQuestion = {
  probeId: string;
  conceptId: string;
  conceptName: string;
  subjectId: string;
  subjectName: string;
  /** How the claim was settled, when this is a re-check. Unset otherwise. */
  recheck?: 'tested' | 'declared';
  /**
   * Set on a survey question: the vault subject it is about, which is not one
   * of your tracks, and that subject's field. `subjectName` is the same name.
   */
  survey?: SurveyAbout;
  /**
   * Set on a goal question (plan #1385): the open learning goal it is about.
   * `subjectName` is the goal's name too, and `subjectId` its hidden subject.
   */
  goal?: GoalAbout;
  question: string;
  options: string[];
};

export type SurveyAbout = { themeName: string; fieldName: string };

export type GoalAbout = { aimId: string; aimName: string };

export type NextQuestion =
  | { kind: 'question'; question: FlowQuestion }
  | { kind: 'nothing'; because: NothingToAsk }
  | { kind: 'error'; detail: string };

type QueuedRow = {
  id: string;
  concept_id: string;
  question: string;
  options: string[] | null;
  picked_state: KnowledgeState;
  picked_recheck: 'tested' | 'declared' | null;
  shown_at: string | null;
};

const QUEUED_COLUMNS = 'id, concept_id, question, options, picked_state, picked_recheck, shown_at';

function fail(action: string, error: { message: string }): Error {
  return new Error(`${action} failed: ${error.message}`);
}

/** The flow's own questions not yet answered or thrown away, oldest first. */
async function readQueue(supabase: LearnSupabaseClient): Promise<{
  waiting: QueuedRow[];
  onScreen: QueuedRow | null;
}> {
  const { data, error } = await supabase
    .from('probes')
    .select(QUEUED_COLUMNS)
    .not('picked_state', 'is', null)
    .is('answered_at', null)
    .is('discarded_at', null)
    .order('created_at', { ascending: true });

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading the questions written ahead', error);

  const rows = (data ?? []) as unknown as QueuedRow[];
  const since = Date.now() - RESUME_HOURS * 60 * 60 * 1000;
  // The newest one shown recently. Older shown rows were walked away from.
  const onScreen =
    rows
      .filter((row) => row.shown_at !== null && new Date(row.shown_at).getTime() >= since)
      .sort((a, b) => b.shown_at!.localeCompare(a.shown_at!))[0] ?? null;

  return { waiting: rows.filter((row) => row.shown_at === null), onScreen };
}

type ClaimNow = {
  name: string;
  state: KnowledgeState;
  subjectId: string;
  subjectName: string;
  /** Set when the claim is in a vault theme's survey subject rather than a track. */
  survey: SurveyAbout | null;
  /** Set when the claim is in a goal's survey subject. */
  goal: GoalAbout | null;
};

/** Whether a claim is in one of your tracks rather than a hidden subject. */
function inTrack(claim: ClaimNow): boolean {
  return claim.survey === null && claim.goal === null;
}

type SurveySubjectRow = {
  id: string;
  name: string;
  theme_id: string | null;
  aim_id: string | null;
};

/**
 * What each survey subject is about: the theme's name and its field.
 *
 * The name is the subject's own, which is the theme's name as it was when the
 * subject was made (`surveySubjectForTheme`). The field is the theme's
 * placement in `learn.theme_fields`, named from `learn.area_fields`. Read only
 * for the survey subjects the queue holds questions about.
 */
async function surveyAbout(
  supabase: LearnSupabaseClient,
  subjects: Pick<SurveySubjectRow, 'id' | 'name' | 'theme_id'>[],
): Promise<Map<string, SurveyAbout>> {
  const about = new Map<string, SurveyAbout>();
  if (subjects.length === 0) return about;

  const themeIds = subjects.flatMap((subject) => (subject.theme_id ? [subject.theme_id] : []));
  const [placed, named] = await Promise.all([
    themeIds.length > 0
      ? supabase.from('theme_fields').select('theme_id, field_id').in('theme_id', themeIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('area_fields').select('id, name'),
  ]);
  assertSchemaExposed(placed.error ?? named.error, LEARN_SCHEMA);
  if (placed.error) throw fail('Reading where those subjects are placed', placed.error);
  if (named.error) throw fail('Reading the fields', named.error);

  const fieldOf = new Map(
    ((placed.data ?? []) as { theme_id: string; field_id: string | null }[]).map((row) => [
      row.theme_id,
      row.field_id,
    ]),
  );
  const fieldName = new Map(
    ((named.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]),
  );
  for (const subject of subjects) {
    const fieldId = subject.theme_id ? fieldOf.get(subject.theme_id) : null;
    about.set(subject.id, {
      themeName: subject.name,
      fieldName: (fieldId && fieldName.get(fieldId)) || '',
    });
  }
  return about;
}

/**
 * The goals the goal subjects in the queue are about, with each goal's name
 * as it is now. A goal archived since is left out, and so are its questions.
 */
async function goalsAbout(
  supabase: LearnSupabaseClient,
  subjects: SurveySubjectRow[],
): Promise<{ about: Map<string, GoalAbout>; archived: Set<string> }> {
  const about = new Map<string, GoalAbout>();
  const archived = new Set<string>();
  const aimIds = [
    ...new Set(subjects.flatMap((subject) => (subject.aim_id ? [subject.aim_id] : []))),
  ];
  if (aimIds.length === 0) return { about, archived };

  const { data, error } = await supabase
    .from('aims')
    .select('id, name, archived_at')
    .in('id', aimIds);
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading your goals', error);
  const aims = new Map(
    ((data ?? []) as { id: string; name: string; archived_at: string | null }[]).map((row) => [
      row.id,
      row,
    ]),
  );
  for (const subject of subjects) {
    const aim = subject.aim_id ? aims.get(subject.aim_id) : undefined;
    if (!aim) continue;
    if (aim.archived_at) archived.add(subject.id);
    else about.set(subject.id, { aimId: aim.id, aimName: aim.name });
  }
  return { about, archived };
}

/**
 * Each claim as it stands now, with its subject. A claim deleted since its
 * question was written is missing from the map, and so is one about a goal
 * archived since.
 */
async function claimsNow(
  supabase: LearnSupabaseClient,
  conceptIds: string[],
): Promise<Map<string, ClaimNow>> {
  const ids = [...new Set(conceptIds)];
  const found = new Map<string, ClaimNow>();
  if (ids.length === 0) return found;

  const [concepts, homes, subjects, surveyRead] = await Promise.all([
    Promise.all(ids.map((id) => loadConcept(supabase, id))),
    supabase.from('concepts').select('id, subject_id').in('id', ids),
    loadSubjects(supabase),
    // `loadSubjects` leaves survey subjects out, so their questions are named
    // from here.
    supabase.from('subjects').select('id, name, theme_id, aim_id').eq('survey', true),
  ]);

  assertSchemaExposed(homes.error ?? surveyRead.error, LEARN_SCHEMA);
  if (homes.error) throw fail('Reading which track those ideas are in', homes.error);
  if (surveyRead.error) throw fail('Reading the survey subjects', surveyRead.error);

  const subjectOf = new Map(
    ((homes.data ?? []) as { id: string; subject_id: string }[]).map((row) => [
      row.id,
      row.subject_id,
    ]),
  );
  const subjectName = new Map(subjects.map((subject) => [subject.id, subject.name]));
  const inQueue = new Set(subjectOf.values());
  const queued = ((surveyRead.data ?? []) as SurveySubjectRow[]).filter((subject) =>
    inQueue.has(subject.id),
  );
  const [about, goals] = await Promise.all([
    surveyAbout(
      supabase,
      queued.filter((subject) => !subject.aim_id),
    ),
    goalsAbout(
      supabase,
      queued.filter((subject) => Boolean(subject.aim_id)),
    ),
  ]);

  for (const concept of concepts) {
    if (!concept) continue;
    const subjectId = subjectOf.get(concept.id);
    if (!subjectId || goals.archived.has(subjectId)) continue;
    const survey = about.get(subjectId) ?? null;
    const goal = goals.about.get(subjectId) ?? null;
    found.set(concept.id, {
      name: concept.name,
      state: concept.state,
      subjectId,
      subjectName: goal
        ? goal.aimName
        : survey
          ? survey.themeName
          : (subjectName.get(subjectId) ?? ''),
      survey,
      goal,
    });
  }
  return found;
}

function asQuestion(row: QueuedRow, claim: ClaimNow): FlowQuestion | null {
  if (!row.options) return null;
  return {
    probeId: row.id,
    conceptId: row.concept_id,
    conceptName: claim.name,
    subjectId: claim.subjectId,
    subjectName: claim.subjectName,
    recheck: row.picked_recheck ?? undefined,
    ...(claim.survey ? { survey: claim.survey } : {}),
    ...(claim.goal ? { goal: claim.goal } : {}),
    question: row.question,
    options: row.options,
  };
}

/** Whether the pick a question came from still holds. */
function holds(row: QueuedRow, claims: Map<string, ClaimNow>): boolean {
  const claim = claims.get(row.concept_id);
  return claim !== undefined && claim.state === row.picked_state && row.options !== null;
}

async function discard(supabase: LearnSupabaseClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from('probes')
    .update({ discarded_at: new Date().toISOString() })
    .in('id', ids)
    .is('shown_at', null);

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Throwing away questions that no longer fit', error);
}

/**
 * The waiting questions whose pick still holds, oldest first, with the rest
 * thrown away. Also the question on the screen, when there is one.
 */
async function sortQueue(supabase: LearnSupabaseClient): Promise<{
  valid: { row: QueuedRow; claim: ClaimNow }[];
  onScreen: { row: QueuedRow; claim: ClaimNow } | null;
}> {
  const { waiting, onScreen } = await readQueue(supabase);
  const claims = await claimsNow(supabase, [
    ...waiting.map((row) => row.concept_id),
    ...(onScreen ? [onScreen.concept_id] : []),
  ]);

  const stale = waiting.filter((row) => !holds(row, claims));
  await discard(
    supabase,
    stale.map((row) => row.id),
  );

  return {
    valid: waiting
      .filter((row) => holds(row, claims))
      .map((row) => ({ row, claim: claims.get(row.concept_id)! })),
    onScreen:
      onScreen && holds(onScreen, claims)
        ? { row: onScreen, claim: claims.get(onScreen.concept_id)! }
        : null,
  };
}

/**
 * What the picks read: the ready and settled ideas, and for a mixed flow the
 * share each track has had. Focused, the one track's top `limit` is enough.
 * A failure to read the shares mixes the old way rather than asking nothing.
 */
async function pickRows(
  supabase: LearnSupabaseClient,
  limit: number,
  track: string | null,
  waiting: ReadonlyMap<string, number> = new Map(),
): Promise<{
  rows: Awaited<ReturnType<typeof loadReadyAndSettled>>;
  shares: TrackShare[] | undefined;
}> {
  if (track !== null) return { rows: await loadReadyAndSettled(supabase, limit, track), shares: undefined };

  const [rows, shares] = await Promise.all([
    loadReadyAndSettled(supabase, Number.POSITIVE_INFINITY, null),
    loadTrackInterest(supabase)
      .then((interest) => sharesFrom(interest, waiting))
      .catch((error: unknown) => {
        console.error('[learn flow] track weights', error instanceof Error ? error.message : error);
        return undefined;
      }),
  ]);
  return { rows, shares };
}

/**
 * Whether a claim is one the flow asks about: in the focused track, in any
 * track for Tracks only, and anything at all with no filter.
 */
function fits(claim: ClaimNow, scope: FlowScope): boolean {
  if (scope.track !== null) return inTrack(claim) && claim.subjectId === scope.track;
  return scope.tracksOnly ? inTrack(claim) : true;
}

/**
 * Take the next waiting question and mark it shown. Null when nothing is
 * waiting that still fits.
 *
 * `resume` is for opening the page: a question already on the screen and not
 * yet answered comes back rather than a new one being taken, so a reload does
 * not spend a question. A focused or Tracks only flow resumes only a question
 * it would ask; one from elsewhere is left as walked away from.
 */
export async function takeWaiting(
  supabase: LearnSupabaseClient,
  options: { resume: boolean } & FlowScope,
): Promise<FlowQuestion | null> {
  const { valid, onScreen } = await sortQueue(supabase);

  if (options.resume && onScreen && fits(onScreen.claim, options)) {
    return asQuestion(onScreen.row, onScreen.claim);
  }

  for (const { row, claim } of valid.filter(({ claim }) => fits(claim, options))) {
    // Conditional on it still being unshown, so two presses at once cannot
    // both take the same question.
    const { data, error } = await supabase
      .from('probes')
      .update({ shown_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('shown_at', null)
      .select('id');

    assertSchemaExposed(error, LEARN_SCHEMA);
    if (error) throw fail('Taking the next question', error);
    if ((data ?? []).length === 0) continue;

    const question = asQuestion(row, claim);
    if (question) return question;
  }
  return null;
}

/**
 * Not now, on the question on the screen (note 7ccc6f99): it goes back to the
 * end of the queue unanswered, so nothing is counted against the claim and the
 * question is asked again after the ones already waiting.
 *
 * Unshown again, and dated now, because the queue is read oldest first by
 * `created_at`. Only while it is still unanswered, so a Not now that races an
 * answer cannot take the answer back.
 */
export async function putBack(supabase: LearnSupabaseClient, probeId: string): Promise<void> {
  const { error } = await supabase
    .from('probes')
    .update({ shown_at: null, created_at: new Date().toISOString() })
    .eq('id', probeId)
    .not('picked_state', 'is', null)
    .is('answered_at', null);

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Putting the question back for later', error);
}

/**
 * Write one question for a pick and store it.
 *
 * `shownAt` is now for a question somebody is waiting on and null for one
 * written ahead, which waits in the queue.
 */
async function writeFor(
  supabase: LearnSupabaseClient,
  userId: string,
  apiKey: string,
  picked: PickedToAsk,
  onSpend: (report: SpendReport) => void,
  shownAt: string | null,
): Promise<NextQuestion> {
  const { concept, subjectId, subjectName } = picked.row;
  const previous = await probesFor(supabase, concept.id);
  const check = nextMasteryCheck(
    concept.mastery,
    previous.map((probe) => probe.masteryCheck),
  );

  const result = await writeProbe({
    concept: concept.name,
    claim: concept.claim,
    check,
    otherChecks: concept.mastery.filter((other) => other !== check),
    asked: previous.map((probe) => probe.question),
    missedBefore: previous.some(
      (probe) =>
        probe.dontKnow === true ||
        (probe.chosenIndex !== null && probe.chosenIndex !== probe.correctIndex),
    ),
    anthropicApiKey: apiKey,
    onSpend,
  });
  if (!result.ok) return { kind: 'error', detail: result.detail };

  const recheck = picked.kind === 'recheck' ? picked.row.established : undefined;
  const probeId = await recordProbe(supabase, userId, {
    conceptId: concept.id,
    probe: result.probe,
    model: PROBE_MODEL,
    flow: { pickedState: concept.state, pickedRecheck: recheck ?? null, shownAt },
  });

  return {
    kind: 'question',
    question: {
      probeId,
      conceptId: concept.id,
      conceptName: concept.name,
      subjectId,
      subjectName,
      recheck,
      question: result.probe.question,
      options: result.probe.options,
    },
  };
}

/**
 * The flow's latest questions, newest first, and what each was about: the
 * ones waiting, the one on the screen and the ones answered. Enough of them
 * for the cadences in `flowSlots`.
 */
async function recentTurns(supabase: LearnSupabaseClient): Promise<FlowTurn[]> {
  const { data, error } = await supabase
    .from('probes')
    .select('concept_id')
    .not('picked_state', 'is', null)
    .is('discarded_at', null)
    .order('created_at', { ascending: false })
    .limit(FLOW_LOOKBACK);
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading the latest questions', error);

  const ids = ((data ?? []) as { concept_id: string }[]).map((row) => row.concept_id);
  if (ids.length === 0) return [];

  const [homes, hidden] = await Promise.all([
    supabase.from('concepts').select('id, subject_id').in('id', [...new Set(ids)]),
    supabase.from('subjects').select('id, aim_id').eq('survey', true),
  ]);
  assertSchemaExposed(homes.error ?? hidden.error, LEARN_SCHEMA);
  if (homes.error) throw fail('Reading which track those ideas are in', homes.error);
  if (hidden.error) throw fail('Reading the survey subjects', hidden.error);
  const subjectOf = new Map(
    ((homes.data ?? []) as { id: string; subject_id: string }[]).map((row) => [
      row.id,
      row.subject_id,
    ]),
  );
  const turnOf = new Map(
    ((hidden.data ?? []) as { id: string; aim_id: string | null }[]).map((row) => [
      row.id,
      row.aim_id ? ('goal' as const) : ('survey' as const),
    ]),
  );
  return ids.map((id) => turnOf.get(subjectOf.get(id) ?? '') ?? 'track');
}

/** Count a question just written in the pool, so the next pick moves on from its field. */
function countWritten(pool: SurveyPool, themeId: string, fieldId: string): void {
  for (const [map, id] of [
    [pool.counts.byTheme, themeId],
    [pool.counts.byField, fieldId],
  ] as const) {
    const count = map.get(id) ?? { asked: 0, answered: 0 };
    map.set(id, { ...count, asked: count.asked + 1 });
  }
}

/**
 * Write up to `count` survey questions about vault subjects that are not
 * tracks, one after another and each about a different theme, and record what
 * they cost. Fewer come back when the survey runs out of themes or a write
 * fails. Never throws.
 */
async function writeSurveys(input: {
  supabase: LearnSupabaseClient;
  vault: VaultSupabaseClient;
  userId: string;
  apiKey: string;
  count: number;
  pool?: SurveyPool;
  shownAt: string | null;
}): Promise<FlowQuestion[]> {
  const written: FlowQuestion[] = [];
  if (input.count <= 0) return written;

  const ideaSpend = collectSpend();
  const questionSpend = collectSpend();
  try {
    const pool = input.pool ?? (await loadSurveyPool(input.supabase, input.vault));
    const skip = new Set<string>();
    while (written.length < input.count) {
      const result = await writeSurveyQuestion({
        supabase: input.supabase,
        vault: input.vault,
        userId: input.userId,
        anthropicApiKey: input.apiKey,
        flow: { shownAt: input.shownAt },
        skip,
        pool,
        onIdeaSpend: ideaSpend.sink,
        onSpend: questionSpend.sink,
      });
      if (!result.ok) {
        if (result.reason === 'error') console.error('[learn flow] survey question', result.detail);
        break;
      }
      const question = result.question;
      skip.add(question.themeId);
      countWritten(pool, question.themeId, question.fieldId);
      written.push({
        probeId: question.probeId,
        conceptId: question.conceptId,
        conceptName: question.conceptName,
        subjectId: question.subjectId,
        subjectName: question.themeName,
        survey: { themeName: question.themeName, fieldName: question.fieldName },
        question: question.question,
        options: question.options,
      });
    }
  } catch (error) {
    console.error('[learn flow] survey question', error instanceof Error ? error.message : error);
  }
  await Promise.all([
    recordLearnSpend(input.userId, 'write-survey-idea', ideaSpend.reports),
    recordLearnSpend(input.userId, 'write-survey-question', questionSpend.reports),
  ]);
  return written;
}

/**
 * Write up to `count` goal questions, taking the goals in turn from `goals`
 * (`loadGoalsInTurn`'s order), and record what they cost. A goal that cannot
 * be written for this time hands its turn to the next goal, and fewer come
 * back when none can. Never throws.
 */
async function writeGoals(input: {
  supabase: LearnSupabaseClient;
  userId: string;
  apiKey: string;
  count: number;
  goals: readonly GoalAim[];
  shownAt: string | null;
}): Promise<FlowQuestion[]> {
  const written: FlowQuestion[] = [];
  if (input.count <= 0 || input.goals.length === 0) return written;

  const ideaSpend = collectSpend();
  const questionSpend = collectSpend();
  try {
    // Rotated after each question, so the next goal turn goes to the next
    // goal. A goal that cannot be written for is dropped for this round.
    const queue = [...input.goals];
    while (written.length < input.count) {
      const aim = queue.shift();
      if (!aim) break;
      // The Level 3 goal asks about the articles claimed on it (plan #1386).
      const write = aim.listSource ? writeLevel3Question : writeGoalQuestion;
      const result = await write({
        supabase: input.supabase,
        userId: input.userId,
        aim,
        anthropicApiKey: input.apiKey,
        flow: { shownAt: input.shownAt },
        onIdeaSpend: ideaSpend.sink,
        onSpend: questionSpend.sink,
      });
      if (!result.ok) {
        if (result.reason === 'error') console.error('[learn flow] goal question', result.detail);
        continue;
      }
      queue.push(aim);
      const question = result.question;
      written.push({
        probeId: question.probeId,
        conceptId: question.conceptId,
        conceptName: question.conceptName,
        subjectId: question.subjectId,
        subjectName: question.aimName,
        goal: { aimId: question.aimId, aimName: question.aimName },
        question: question.question,
        options: question.options,
      });
    }
  } catch (error) {
    console.error('[learn flow] goal question', error instanceof Error ? error.message : error);
  }
  await Promise.all([
    recordLearnSpend(input.userId, 'write-survey-idea', ideaSpend.reports),
    recordLearnSpend(input.userId, 'write-survey-question', questionSpend.reports),
  ]);
  return written;
}

/** The active goals in turn, or none when they cannot be read. */
function goalsOrNone(supabase: LearnSupabaseClient): Promise<GoalAim[]> {
  return loadGoalsInTurn(supabase).catch((error: unknown) => {
    console.error('[learn flow] goals', error instanceof Error ? error.message : error);
    return [];
  });
}

/**
 * The next question: a waiting one when there is one, otherwise written now.
 *
 * Writing now is the slow path, for the first question ever and for a queue
 * that ran dry because answers came faster than the writing. It is recorded
 * under `write-probe`, the same as before there was a queue. It writes a
 * track's question when there is one to ask. With no filter and nothing left
 * in the tracks, it writes a question about an open goal instead, and failing
 * that a survey question, which needs `vault`.
 */
export async function nextQuestion(
  supabase: LearnSupabaseClient,
  userId: string,
  options: { resume: boolean; vault?: VaultSupabaseClient } & FlowScope,
): Promise<NextQuestion> {
  const waiting = await takeWaiting(supabase, options);
  if (waiting) return { kind: 'question', question: waiting };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { kind: 'error', detail: 'Asking a question needs ANTHROPIC_API_KEY to be set.' };

  const [subjects, { rows, shares }, answered] = await Promise.all([
    loadSubjects(supabase),
    pickRows(supabase, 1, options.track),
    answeredCount(supabase),
  ]);
  const picked = pickOneToAsk({
    ready: rows.ready,
    settled: rows.settled,
    shares,
    subjectCount: subjects.filter((subject) => options.track === null || subject.id === options.track)
      .length,
    answered,
    now: new Date(),
  });
  if (picked.kind === 'nothing') {
    if (surveys(options)) {
      const [goal] = await writeGoals({
        supabase,
        userId,
        apiKey,
        count: 1,
        goals: await goalsOrNone(supabase),
        shownAt: new Date().toISOString(),
      });
      if (goal) return { kind: 'question', question: goal };
    }
    if (options.vault && surveys(options)) {
      const [survey] = await writeSurveys({
        supabase,
        vault: options.vault,
        userId,
        apiKey,
        count: 1,
        shownAt: new Date().toISOString(),
      });
      if (survey) return { kind: 'question', question: survey };
    }
    return { kind: 'nothing', because: picked.because };
  }

  const spend = collectSpend();
  const written = await writeFor(supabase, userId, apiKey, picked, spend.sink, new Date().toISOString());
  await recordLearnSpend(userId, 'write-probe', spend.reports);
  return written;
}

/**
 * Bring the queue back up to `WRITE_AHEAD`. Meant to run from `after()`.
 *
 * The picks leave out every claim already waiting and the one on the screen,
 * and count them towards the re-check cadence, so the queue reads the way the
 * live picks would have. Never throws: a queue that failed to fill only means
 * the next Next writes its question live.
 *
 * Focused on a track, it counts and fills only that track's share, so the
 * queue can hold up to `WRITE_AHEAD` for the track on top of what is waiting
 * for the others. Tracks only counts and fills only track questions.
 *
 * With no filter, some of the new questions are about your open goals and,
 * with `vault` given, some are survey questions, as many of each as
 * `flowSlots` says: one in three for goals while there is an open goal, and
 * the rate `surveyShare` works out for the survey among the rest. When the
 * tracks have fewer questions to ask than their slots, the survey takes the
 * rest, or the goals when there is no survey; when a goal or survey question
 * cannot be written, a track question takes its slot.
 */
export async function fillQueue(
  supabase: LearnSupabaseClient,
  userId: string,
  scope: FlowScope,
  vault?: VaultSupabaseClient,
): Promise<void> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return;

    const { valid, onScreen } = await sortQueue(supabase);
    const waiting = valid.filter(({ claim }) => fits(claim, scope));
    const wanted = WRITE_AHEAD - waiting.length;
    if (wanted <= 0) return;

    const waitingByTrack = new Map<string, number>();
    for (const { claim } of valid) {
      if (!inTrack(claim)) continue;
      waitingByTrack.set(claim.subjectId, (waitingByTrack.get(claim.subjectId) ?? 0) + 1);
    }

    const mixing = vault !== undefined && surveys(scope);
    const [subjects, { rows, shares }, answered, pool, recent, goals] = await Promise.all([
      loadSubjects(supabase),
      pickRows(supabase, READY_LIMIT, scope.track, waitingByTrack),
      answeredCount(supabase),
      mixing
        ? loadSurveyPool(supabase, vault).catch((error: unknown) => {
            console.error('[learn flow] survey pool', error instanceof Error ? error.message : error);
            return null;
          })
        : null,
      surveys(scope) ? recentTurns(supabase).catch(() => [] as FlowTurn[]) : ([] as FlowTurn[]),
      surveys(scope) ? goalsOrNone(supabase) : ([] as GoalAim[]),
    ]);

    const picks = pickAhead(
      {
        ready: rows.ready,
        settled: rows.settled,
        shares,
        subjectCount: subjects.filter((subject) => scope.track === null || subject.id === scope.track)
          .length,
        answered,
        now: new Date(),
      },
      wanted,
      [
        ...(onScreen ? [onScreen.row.concept_id] : []),
        ...waiting.map(({ row }) => row.concept_id),
      ],
    );

    const slots = flowSlots(
      recent,
      {
        goal: goals.length > 0 ? GOAL_SHARE : 0,
        survey: pool ? surveyShare(fieldsWrittenAbout(pool)) : 0,
      },
      wanted,
    );
    let goalWanted = slots.filter((slot) => slot === 'goal').length;
    let surveyWanted = slots.filter((slot) => slot === 'survey').length;
    // The tracks running short hand their slots to the survey, or to the
    // goals when there is no survey.
    const trackShort = wanted - goalWanted - surveyWanted - picks.length;
    if (trackShort > 0 && pool) surveyWanted += trackShort;
    else if (trackShort > 0 && goals.length > 0) goalWanted += trackShort;
    const trackWanted = wanted - goalWanted - surveyWanted;
    if (picks.length === 0 && surveyWanted === 0 && goalWanted === 0) return;

    const spend = collectSpend();
    const writeTracks = (list: PickedToAsk[]) =>
      Promise.all(list.map((picked) => writeFor(supabase, userId, apiKey, picked, spend.sink, null)));

    const [written, surveyed, goaled] = await Promise.all([
      writeTracks(picks.slice(0, trackWanted)),
      pool && vault
        ? writeSurveys({ supabase, vault, userId, apiKey, count: surveyWanted, pool, shownAt: null })
        : ([] as FlowQuestion[]),
      writeGoals({ supabase, userId, apiKey, count: goalWanted, goals, shownAt: null }),
    ]);
    // A goal or survey slot that could not be written goes to the next track pick.
    const short = surveyWanted - surveyed.length + goalWanted - goaled.length;
    const backups = short > 0 ? await writeTracks(picks.slice(trackWanted, trackWanted + short)) : [];
    await recordLearnSpend(userId, 'write-probe-ahead', spend.reports);

    for (const result of [...written, ...backups]) {
      if (result.kind === 'error') console.error('[learn flow] writing ahead', result.detail);
    }
  } catch (error) {
    console.error('[learn flow] writing ahead', error instanceof Error ? error.message : error);
  }
}
