'use server';

import { after } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { fillQueue, nextQuestion } from '@/lib/learn/flow/ahead';
import {
  loadTrackOffer,
  recordTrackOffer,
  startTrackFromTheme,
  themeName,
  themeStrength,
} from '@/lib/learn/flow/offer';
import { trackMove } from '@/lib/learn/flow/track';
import { loadGraph, loadReadingToOffer } from '@/lib/learn/graph/load';
import { recordOutcome } from '@/lib/learn/next/record';
import { createVaultClient } from '@/lib/vault/auth/server';
import { answerQuestion } from '../s/[id]/probe/actions';
import { toFlowState, type FlowState } from './state';

/**
 * Practice Flow: a question, its answer, and then the next question, for as
 * long as you keep pressing Next.
 *
 * Asking is its own action because the claim is picked across every subject
 * rather than inside one. Answering is the subject session's action called
 * through a wrapper, so the concept state, what a right answer settles
 * underneath it, and a repeated wrong answer becoming a named misconception
 * are the same code in both places rather than two versions that drift.
 *
 * The questions themselves are mostly written before they are asked for
 * (`lib/learn/flow/ahead.ts`): Next takes one off a queue, and the queue is
 * topped up from `after()` once the response has gone.
 */

export type { FlowState };

const TrackId = z.string().uuid();

/**
 * The track a focused flow asks about, from the form's hidden `track` field,
 * or null for asking across all of them (plan #779). Not trusted for
 * ownership: it only narrows which of your own subjects are read, and a
 * subject that is not yours reads as none.
 */
function trackFrom(formData: FormData): string | null {
  const track = TrackId.safeParse(formData.get('track'));
  return track.success ? track.data : null;
}

/**
 * Asks, or answers, depending on which form was submitted.
 *
 * One action rather than two, because the flow alternates between them
 * indefinitely: with a separate state for each, whichever ran last would
 * have to be worked out on every render, and the question after an answer
 * would be read from the wrong one.
 *
 * Either way the queue of questions written ahead is topped up afterwards.
 * After an answer is when it matters: the claim just answered may have moved,
 * and the picks after it are worked out from where things stand now.
 */
// latency: pending
export async function flowStep(prev: FlowState, formData: FormData): Promise<FlowState> {
  const user = await requireUser();
  const supabase = await createLearnClient();

  const track = trackFrom(formData);
  const intent = formData.get('intent');

  const state =
    intent === 'answer'
      ? await answerFlowQuestion(prev, formData, track)
      : intent === 'start-track'
        ? await startOfferedTrack(prev, formData, user.id)
        : toFlowState(await nextQuestion(supabase, user.id, { resume: false, track }));

  after(() => fillQueue(supabase, user.id, track));
  return state;
}

const ThemeId = z.string().uuid();

/**
 * Start, on a new track the flow offered (plan #778, #776's answer A).
 *
 * The track is written without an approval screen, and the next question is
 * taken from it straight away, so starting a track puts one of its questions
 * on the screen in the same press. The flow carries on mixing afterwards: the
 * new track's ideas are ready ones like any other, and the picks reach them.
 *
 * A failure keeps everything on the screen as it was and says why on the card.
 */
async function startOfferedTrack(
  prev: FlowState,
  formData: FormData,
  userId: string,
): Promise<FlowState> {
  const themeId = ThemeId.safeParse(formData.get('themeId'));
  if (!themeId.success) return { ...prev, offerError: 'Could not tell which theme that was.' };

  const [supabase, vault] = await Promise.all([createLearnClient(), createVaultClient()]);
  const started = await startTrackFromTheme(supabase, vault, userId, themeId.data).catch(
    (error: unknown) => ({
      ok: false as const,
      detail: error instanceof Error ? error.message : 'Could not start that track.',
    }),
  );
  if (!started.ok) return { ...prev, offerError: started.detail };

  const next = toFlowState(
    await nextQuestion(supabase, userId, { resume: false, track: started.subjectId }),
  );
  return { ...next, started: started.name };
}

/**
 * Tops the queue up without asking anything. Called once when the page opens,
 * so a queue that ran down while you were away is full again by the time you
 * have answered the question already on the screen.
 */
// latency: instant
export async function fillFlowQueue(track: string | null): Promise<void> {
  const user = await requireUser();
  const supabase = await createLearnClient();
  const focus = TrackId.safeParse(track);
  after(() => fillQueue(supabase, user.id, focus.success ? focus.data : null));
}

/**
 * The subject session's answer, with the subject kept on the state and the
 * track's move worked out around it.
 *
 * `answerQuestion` returns the shape it was given, which has no subject name
 * on it, so the fields this screen needs for the link onwards are carried
 * across from the previous state.
 *
 * The graph is read before the answer and again after it, because what an
 * answer settles is decided inside `answerQuestion` (the claim itself, and by
 * inference what it rests on) and the counts on either side are the only
 * record of it. Failing to read either loses the track line, not the answer.
 * The reading offered under the answer is looked up alongside the second read.
 */
async function answerFlowQuestion(
  prev: FlowState,
  formData: FormData,
  focus: string | null,
): Promise<FlowState> {
  const supabase = await createLearnClient();
  const subjectId = prev.subjectId;
  const before = subjectId ? await loadGraph(supabase, subjectId).catch(() => null) : null;

  const answered: FlowState = {
    ...prev,
    track: undefined,
    reading: undefined,
    offer: undefined,
    offerError: undefined,
    started: undefined,
    ...(await answerQuestion(prev, formData)),
  };
  if (!answered.answered || answered.error) return answered;

  // A new track is offered only when the flow mixes: focused on one track,
  // running low means that track is nearly done, not that you need another.
  const [after, reading, offer] = await Promise.all([
    before && subjectId ? loadGraph(supabase, subjectId).catch(() => null) : null,
    readingFor(supabase, prev.conceptId ?? null),
    focus === null ? createVaultClient().then((vault) => loadTrackOffer(supabase, vault)) : null,
  ]);
  return {
    ...answered,
    ...(before && after ? { track: trackMove(before, after) } : {}),
    ...(reading ? { reading } : {}),
    ...(offer ? { offer } : {}),
  };
}

/**
 * The queued reading to offer under an answer, preferring one about the claim
 * just answered. A failure to read the queue loses the offer, not the answer.
 */
async function readingFor(
  supabase: LearnSupabaseClient,
  conceptId: string | null,
): Promise<FlowState['reading'] | null> {
  const row = await loadReadingToOffer(supabase, conceptId).catch(() => null);
  return row ? { id: row.readingId, title: row.title, reason: row.reason } : null;
}

const ReadingId = z.string().uuid();

/**
 * Not now, on a reading the flow offered.
 *
 * The same outcome Learn next's Not now wrote, so the reading stays out of
 * the offer for the few weeks `lib/learn/next/rank.ts` holds it. Nothing is
 * revalidated: the panel hides the offer itself, and refreshing /learn would
 * run the page again and take a new question off the queue.
 *
 * The id comes from the form and is not trusted for ownership. The insert goes
 * through the session client, so RLS decides whether there is a reading there.
 */
// latency: optimistic
export async function pushReadingAside(formData: FormData): Promise<void> {
  const user = await requireUser();
  const readingId = ReadingId.safeParse(formData.get('readingId'));
  if (!readingId.success) return;

  const supabase = await createLearnClient();
  await recordOutcome(supabase, user.id, {
    kind: 'reading',
    readingId: readingId.data,
    outcome: 'not_now',
  });
}

const OfferAnswer = z.object({
  themeId: z.string().uuid(),
  outcome: z.enum(['not_now', 'never']),
});

/**
 * Not now or Never, on a new track the flow offered (plan #778).
 *
 * Not now holds the theme back for a few weeks; Never stops it being offered
 * again. Both are kept in `learn.track_offers`, which is also what plan #780
 * reads to learn which offers you take up. Nothing is revalidated, for the
 * reason `pushReadingAside` gives: the card hides itself.
 *
 * The theme is read back through the session's own client for its name, so an
 * id from the form that is not one of your themes records nothing.
 */
// latency: optimistic
export async function answerTrackOffer(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = OfferAnswer.safeParse({
    themeId: formData.get('themeId'),
    outcome: formData.get('outcome'),
  });
  if (!parsed.success) return;

  const [supabase, vault] = await Promise.all([createLearnClient(), createVaultClient()]);
  const [name, strength] = await Promise.all([
    themeName(vault, parsed.data.themeId),
    themeStrength(vault, parsed.data.themeId),
  ]);
  if (!name) return;

  await recordTrackOffer(supabase, user.id, {
    themeId: parsed.data.themeId,
    themeName: name,
    themeStrength: strength,
    outcome: parsed.data.outcome,
  });
}
