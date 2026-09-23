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
import { writeSurveyQuestion } from '@/lib/learn/survey/question';
import { fieldsWrittenAbout, SURVEY_LOOKBACK, surveyShare, surveySlots } from '@/lib/learn/survey/rate';
import { loadSurveySubjectIds } from '@/lib/learn/survey/subject';
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
 */

/**
 * Which questions the flow asks. `track` focuses it on one track (plan #779);
 * with none, `tracksOnly` asks across your tracks and nothing else, and
 * without it the survey is mixed in.
 */
export type FlowScope = { track: string | null; tracksOnly?: boolean };

/** Whether the flow mixes in survey questions. */
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
  question: string;
  options: string[];
};

export type SurveyAbout = { themeName: string; fieldName: string };

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
  /** Set when the claim is in a survey subject rather than a track. */
  survey: SurveyAbout | null;
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
  subjects: { id: string; name: string; theme_id: string | null }[],
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
 * Each claim as it stands now, with its subject. A claim deleted since its
 * question was written is missing from the map.
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
    supabase.from('subjects').select('id, name, theme_id').eq('survey', true),
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
  const about = await surveyAbout(
    supabase,
    ((surveyRead.data ?? []) as { id: string; name: string; theme_id: string | null }[]).filter(
      (subject) => inQueue.has(subject.id),
    ),
  );

  for (const concept of concepts) {
    if (!concept) continue;
    const subjectId = subjectOf.get(concept.id);
    if (!subjectId) continue;
    const survey = about.get(subjectId) ?? null;
    found.set(concept.id, {
      name: concept.name,
      state: concept.state,
      subjectId,
      subjectName: survey ? survey.themeName : (subjectName.get(subjectId) ?? ''),
      survey,
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
  if (scope.track !== null) return claim.survey === null && claim.subjectId === scope.track;
  return scope.tracksOnly ? claim.survey === null : true;
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
 * The flow's latest questions, newest first, and whether each was a survey
 * question: the ones waiting, the one on the screen and the ones answered.
 * Enough of them for the survey cadence in `surveySlots`.
 */
async function recentSurveyTurns(supabase: LearnSupabaseClient): Promise<boolean[]> {
  const { data, error } = await supabase
    .from('probes')
    .select('concept_id')
    .not('picked_state', 'is', null)
    .is('discarded_at', null)
    .order('created_at', { ascending: false })
    .limit(SURVEY_LOOKBACK);
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading the latest questions', error);

  const ids = ((data ?? []) as { concept_id: string }[]).map((row) => row.concept_id);
  if (ids.length === 0) return [];

  const [homes, surveyIds] = await Promise.all([
    supabase.from('concepts').select('id, subject_id').in('id', [...new Set(ids)]),
    loadSurveySubjectIds(supabase),
  ]);
  assertSchemaExposed(homes.error, LEARN_SCHEMA);
  if (homes.error) throw fail('Reading which track those ideas are in', homes.error);
  const subjectOf = new Map(
    ((homes.data ?? []) as { id: string; subject_id: string }[]).map((row) => [
      row.id,
      row.subject_id,
    ]),
  );
  return ids.map((id) => surveyIds.has(subjectOf.get(id) ?? ''));
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
 * The next question: a waiting one when there is one, otherwise written now.
 *
 * Writing now is the slow path, for the first question ever and for a queue
 * that ran dry because answers came faster than the writing. It is recorded
 * under `write-probe`, the same as before there was a queue. It writes a
 * track's question when there is one to ask. With no filter and nothing left
 * in the tracks, it writes a survey question instead, which needs `vault`.
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
 * With no filter, and `vault` given, some of the new questions are survey
 * questions, as many as `surveySlots` says for the rate `surveyShare` works
 * out. When the tracks have fewer questions to ask than their slots, the
 * survey takes the rest; when the survey cannot write one, a track question
 * takes its slot.
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
      if (claim.survey) continue;
      waitingByTrack.set(claim.subjectId, (waitingByTrack.get(claim.subjectId) ?? 0) + 1);
    }

    const mixing = vault !== undefined && surveys(scope);
    const [subjects, { rows, shares }, answered, pool, recent] = await Promise.all([
      loadSubjects(supabase),
      pickRows(supabase, READY_LIMIT, scope.track, waitingByTrack),
      answeredCount(supabase),
      mixing
        ? loadSurveyPool(supabase, vault).catch((error: unknown) => {
            console.error('[learn flow] survey pool', error instanceof Error ? error.message : error);
            return null;
          })
        : null,
      mixing ? recentSurveyTurns(supabase).catch(() => [] as boolean[]) : ([] as boolean[]),
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

    let surveyWanted = pool
      ? surveySlots(recent, surveyShare(fieldsWrittenAbout(pool)), wanted).filter(Boolean).length
      : 0;
    if (pool && picks.length < wanted - surveyWanted) surveyWanted = wanted - picks.length;
    const trackWanted = wanted - surveyWanted;
    if (picks.length === 0 && surveyWanted === 0) return;

    const spend = collectSpend();
    const writeTracks = (list: PickedToAsk[]) =>
      Promise.all(list.map((picked) => writeFor(supabase, userId, apiKey, picked, spend.sink, null)));

    const [written, surveyed] = await Promise.all([
      writeTracks(picks.slice(0, trackWanted)),
      pool && vault
        ? writeSurveys({ supabase, vault, userId, apiKey, count: surveyWanted, pool, shownAt: null })
        : ([] as FlowQuestion[]),
    ]);
    // A survey slot that could not be written goes to the next track pick.
    const short = surveyWanted - surveyed.length;
    const backups = short > 0 ? await writeTracks(picks.slice(trackWanted, trackWanted + short)) : [];
    await recordLearnSpend(userId, 'write-probe-ahead', spend.reports);

    for (const result of [...written, ...backups]) {
      if (result.kind === 'error') console.error('[learn flow] writing ahead', result.detail);
    }
  } catch (error) {
    console.error('[learn flow] writing ahead', error instanceof Error ? error.message : error);
  }
}
