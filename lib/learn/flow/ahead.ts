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
 */

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
  question: string;
  options: string[];
};

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

type ClaimNow = { name: string; state: KnowledgeState; subjectId: string; subjectName: string };

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

  const [concepts, homes, subjects] = await Promise.all([
    Promise.all(ids.map((id) => loadConcept(supabase, id))),
    supabase.from('concepts').select('id, subject_id').in('id', ids),
    loadSubjects(supabase),
  ]);

  assertSchemaExposed(homes.error, LEARN_SCHEMA);
  if (homes.error) throw fail('Reading which track those ideas are in', homes.error);

  const subjectOf = new Map(
    ((homes.data ?? []) as { id: string; subject_id: string }[]).map((row) => [
      row.id,
      row.subject_id,
    ]),
  );
  const subjectName = new Map(subjects.map((subject) => [subject.id, subject.name]));

  for (const concept of concepts) {
    if (!concept) continue;
    const subjectId = subjectOf.get(concept.id);
    if (!subjectId) continue;
    found.set(concept.id, {
      name: concept.name,
      state: concept.state,
      subjectId,
      subjectName: subjectName.get(subjectId) ?? '',
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

/** Whether a claim belongs to the track the flow is focused on. Always, when mixed. */
function inTrack(claim: ClaimNow, track: string | null): boolean {
  return track === null || claim.subjectId === track;
}

/**
 * Take the next waiting question and mark it shown. Null when nothing is
 * waiting that still fits.
 *
 * `resume` is for opening the page: a question already on the screen and not
 * yet answered comes back rather than a new one being taken, so a reload does
 * not spend a question. A focused flow resumes only a question from its own
 * track; one from elsewhere is left as walked away from.
 */
export async function takeWaiting(
  supabase: LearnSupabaseClient,
  options: { resume: boolean; track: string | null },
): Promise<FlowQuestion | null> {
  const { valid, onScreen } = await sortQueue(supabase);

  if (options.resume && onScreen && inTrack(onScreen.claim, options.track)) {
    return asQuestion(onScreen.row, onScreen.claim);
  }

  for (const { row, claim } of valid.filter(({ claim }) => inTrack(claim, options.track))) {
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
 * The next question: a waiting one when there is one, otherwise written now.
 *
 * Writing now is the slow path, for the first question ever and for a queue
 * that ran dry because answers came faster than the writing. It is recorded
 * under `write-probe`, the same as before there was a queue.
 */
export async function nextQuestion(
  supabase: LearnSupabaseClient,
  userId: string,
  options: { resume: boolean; track: string | null },
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
  if (picked.kind === 'nothing') return { kind: 'nothing', because: picked.because };

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
 * for the others.
 */
export async function fillQueue(
  supabase: LearnSupabaseClient,
  userId: string,
  track: string | null,
): Promise<void> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return;

    const { valid, onScreen } = await sortQueue(supabase);
    const waiting = valid.filter(({ claim }) => inTrack(claim, track));
    const wanted = WRITE_AHEAD - waiting.length;
    if (wanted <= 0) return;

    const waitingByTrack = new Map<string, number>();
    for (const { claim } of valid) {
      waitingByTrack.set(claim.subjectId, (waitingByTrack.get(claim.subjectId) ?? 0) + 1);
    }

    const [subjects, { rows, shares }, answered] = await Promise.all([
      loadSubjects(supabase),
      pickRows(supabase, READY_LIMIT, track, waitingByTrack),
      answeredCount(supabase),
    ]);

    const picks = pickAhead(
      {
        ready: rows.ready,
        settled: rows.settled,
        shares,
        subjectCount: subjects.filter((subject) => track === null || subject.id === track).length,
        answered,
        now: new Date(),
      },
      wanted,
      [
        ...(onScreen ? [onScreen.row.concept_id] : []),
        ...waiting.map(({ row }) => row.concept_id),
      ],
    );
    if (picks.length === 0) return;

    const spend = collectSpend();
    const written = await Promise.all(
      picks.map((picked) => writeFor(supabase, userId, apiKey, picked, spend.sink, null)),
    );
    await recordLearnSpend(userId, 'write-probe-ahead', spend.reports);

    for (const result of written) {
      if (result.kind === 'error') console.error('[learn flow] writing ahead', result.detail);
    }
  } catch (error) {
    console.error('[learn flow] writing ahead', error instanceof Error ? error.message : error);
  }
}
