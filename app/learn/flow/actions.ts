'use server';

import { after } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { fillQueue, goalScoped, nextQuestion, putBack, type FlowScope } from '@/lib/learn/flow/ahead';
import {
  loadTrackOffer,
  recordTrackOffer,
  startTrackFromTheme,
  themeName,
  themeStrength,
} from '@/lib/learn/flow/offer';
import { trackMove } from '@/lib/learn/flow/track';
import { goalsOnlyOrDefault } from '@/lib/learn/goals-only-setting';
import { answerExplainFollowUp, answerExplanation } from '@/lib/learn/flow/explain-store';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { loadGraph } from '@/lib/learn/graph/load';
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
 * Which questions the flow asks, from the form's hidden `track`, `only` and
 * `goal` fields. `track` is the track a focused flow asks about, or empty for
 * asking across all of them (plan #779). `only=tracks` is the Tracks only
 * filter (plan #842): with it, and with a track, no survey or goal questions
 * are asked. `only=goals` asks about goals alone and `goal` about one goal
 * (plan #1387). Neither id is trusted for ownership: each only narrows which
 * of your own rows are read, and one that is not yours reads as none.
 */
function scopeFrom(formData: FormData): FlowScope {
  return scopeOf(formData.get('track'), formData.get('only'), formData.get('goal'));
}

function scopeOf(track: unknown, only: unknown, goal: unknown): FlowScope {
  const focus = TrackId.safeParse(track);
  const aim = TrackId.safeParse(goal);
  return {
    track: focus.success ? focus.data : null,
    tracksOnly: only === 'tracks',
    goalsOnly: only === 'goals',
    aim: aim.success ? aim.data : null,
  };
}

/**
 * Asks, or answers, depending on which form was submitted.
 *
 * One action rather than two, because the flow alternates between them
 * indefinitely: with a separate state for each, whichever ran last would
 * have to be worked out on every render, and the question after an answer
 * would be read from the wrong one.
 *
 * An explain question (plan #2164.2) is answered here too: its explanation
 * comes with intent `answer` and is marked by the teach-back grader, and its
 * one follow-up comes with intent `follow-up`.
 *
 * Either way the queue of questions written ahead is topped up afterwards.
 * After an answer is when it matters: the claim just answered may have moved,
 * and the picks after it are worked out from where things stand now.
 */
// latency: pending
export async function flowStep(prev: FlowState, formData: FormData): Promise<FlowState> {
  const user = await requireUser();
  const [supabase, vault] = await Promise.all([createLearnClient(), createVaultClient()]);

  // Goals only on Learn settings (plan #2164.1) takes the survey out of every filter.
  const scope = { ...scopeFrom(formData), noSurvey: await goalsOnlyOrDefault(supabase, user.id) };
  const intent = formData.get('intent');

  // Not now is a button on the answer form, so it arrives carrying that
  // form's intent and is told apart by its own field.
  const state =
    formData.get('notNow') === '1'
      ? await notNow(prev, scope, user.id)
      : intent === 'answer' && prev.explain
        ? await answerExplainQuestion(prev, formData, user.id)
        : intent === 'follow-up'
          ? await answerFollowUp(prev, formData, user.id)
          : intent === 'answer'
            ? await answerFlowQuestion(prev, formData, scope)
            : intent === 'start-track'
              ? await startOfferedTrack(prev, formData, user.id)
              : toFlowState(
                  await nextQuestion(supabase, user.id, { resume: false, ...scope, vault }),
                );

  after(() => fillQueue(supabase, user.id, scope, vault));
  return state;
}

/**
 * Not now, on a question (note 7ccc6f99): the next question comes up and this
 * one goes back to the end of the queue, unanswered, so it counts neither way
 * and is asked again later.
 *
 * The next one is taken before this one is put back, so the question just set
 * aside cannot be the one that comes up. With nothing else to ask, the same
 * question stays on the screen rather than the flow saying it is finished.
 */
async function notNow(prev: FlowState, scope: FlowScope, userId: string): Promise<FlowState> {
  if (!prev.probeId || prev.answered || prev.explained) return prev;
  const [supabase, vault] = await Promise.all([createLearnClient(), createVaultClient()]);

  const next = await nextQuestion(supabase, userId, { resume: false, ...scope, vault });
  if (next.kind === 'error') return { ...prev, error: next.detail };
  if (next.kind === 'nothing') {
    return { ...prev, error: 'Nothing else to ask right now, so this one stays.' };
  }

  await putBack(supabase, prev.probeId);
  return toFlowState(next);
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
      detail: error instanceof Error ? error.message : 'Could not start that subject.',
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
export async function fillFlowQueue(focus: {
  track: string | null;
  only?: 'tracks' | 'goals' | null;
  goal?: string | null;
}): Promise<void> {
  const user = await requireUser();
  const [supabase, vault] = await Promise.all([createLearnClient(), createVaultClient()]);
  const scope = {
    ...scopeOf(focus?.track, focus?.only, focus?.goal),
    noSurvey: await goalsOnlyOrDefault(supabase, user.id),
  };
  after(() => fillQueue(supabase, user.id, scope, vault));
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
 */
async function answerFlowQuestion(
  prev: FlowState,
  formData: FormData,
  scope: FlowScope,
): Promise<FlowState> {
  const supabase = await createLearnClient();
  // A survey or goal question's subject is hidden, not a track, so it has no
  // track line to move.
  const subjectId = prev.survey || prev.goal ? undefined : prev.subjectId;
  const before = subjectId ? await loadGraph(supabase, subjectId).catch(() => null) : null;

  const answered: FlowState = {
    ...prev,
    track: undefined,
    offer: undefined,
    offerError: undefined,
    started: undefined,
    ...(await answerQuestion(prev, formData)),
  };
  if (!answered.answered || answered.error) return answered;

  // A new track is offered only when the flow mixes: focused on one track,
  // running low means that track is nearly done, not that you need another,
  // and asking about goals alone it has nothing to do with what you asked for.
  const [after, offer] = await Promise.all([
    before && subjectId ? loadGraph(supabase, subjectId).catch(() => null) : null,
    scope.track === null && !goalScoped(scope) ? createVaultClient().then((vault) => loadTrackOffer(supabase, vault)) : null,
  ]);
  return {
    ...answered,
    ...(before && after ? { track: trackMove(before, after) } : {}),
    ...(offer ? { offer } : {}),
  };
}

const MAX_EXPLANATION = 4000;
const Written = z.string().trim().min(1).max(MAX_EXPLANATION);

/** The typed answer, or why it cannot be marked. */
function writtenAnswer(
  raw: FormDataEntryValue | null,
): { ok: true; text: string } | { ok: false; error: string } {
  const parsed = Written.safeParse(typeof raw === 'string' ? raw : '');
  if (parsed.success) return { ok: true, text: parsed.data };
  return {
    ok: false,
    error:
      typeof raw === 'string' && raw.trim().length > MAX_EXPLANATION
        ? 'That is longer than a few sentences. Cut it down and send it again.'
        : 'Write a few sentences first.',
  };
}

/**
 * The explanation, on an explain question (plan #2164.2): marked by the
 * teach-back grader, with the one follow-up it writes. "I don't know" is a
 * miss with nothing to mark. A failure keeps the question and what was
 * written on the screen, with the reason under it.
 */
async function answerExplainQuestion(
  prev: FlowState,
  formData: FormData,
  userId: string,
): Promise<FlowState> {
  if (!prev.probeId || !prev.conceptId)
    return { ...prev, error: 'Could not work out what you answered.' };
  if (prev.explained) return prev;
  const dontKnow = formData.get('dontKnow') === '1';
  const typed = dontKnow ? null : writtenAnswer(formData.get('response'));
  if (typed && !typed.ok) return { ...prev, error: typed.error };

  const supabase = await createLearnClient();
  const spend = collectSpend();
  const result = await answerExplanation(supabase, userId, {
    probeId: prev.probeId,
    conceptId: prev.conceptId,
    response: typed?.ok ? typed.text : '',
    dontKnow,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    onSpend: spend.sink,
  }).catch((error: unknown) => ({
    ok: false as const,
    detail: error instanceof Error ? error.message : 'Could not mark that.',
  }));
  await recordLearnSpend(userId, 'mark-teach-back', spend.reports);

  const explanation = typed?.ok ? typed.text : undefined;
  if (!result.ok) return { ...prev, explanation, error: result.detail };
  return { ...prev, explanation, explained: result.value, error: undefined };
}

/** The answer to the follow-up an explanation was given (plan #2164.2). */
async function answerFollowUp(
  prev: FlowState,
  formData: FormData,
  userId: string,
): Promise<FlowState> {
  const followUp = prev.explained?.followUp;
  if (!prev.probeId || !prev.conceptId || !followUp) {
    return { ...prev, error: 'Could not work out what you answered.' };
  }
  if (prev.followedUp) return prev;
  const typed = writtenAnswer(formData.get('response'));
  if (!typed.ok) return { ...prev, error: typed.error };

  const supabase = await createLearnClient();
  const spend = collectSpend();
  const result = await answerExplainFollowUp(supabase, userId, {
    probeId: prev.probeId,
    followUpId: followUp.probeId,
    conceptId: prev.conceptId,
    response: typed.text,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    onSpend: spend.sink,
  }).catch((error: unknown) => ({
    ok: false as const,
    detail: error instanceof Error ? error.message : 'Could not mark that.',
  }));
  await recordLearnSpend(userId, 'mark-teach-back', spend.reports);

  if (!result.ok) return { ...prev, followUpAnswer: typed.text, error: result.detail };
  return { ...prev, followUpAnswer: typed.text, followedUp: result.value, error: undefined };
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
 * reads to learn which offers you take up. Nothing is revalidated: the card
 * hides itself, and refreshing the flow would run the page again and take a
 * new question off the queue.
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

const OfferPress = z.union([
  z.object({ themeId: z.string().uuid() }),
  z.object({ subjectId: z.string().uuid() }),
]);

/**
 * The toast's Undo on Later, Decline or Drop of an offered track (plan
 * #1957.3): the newest answer on that theme, or on that resting subject, is
 * taken back, so the offer can come again as if it had not been answered.
 */
// latency: pending
export async function takeBackOfferAnswer(
  input: { themeId: string } | { subjectId: string },
): Promise<void> {
  const user = await requireUser();
  const parsed = OfferPress.safeParse(input);
  if (!parsed.success) return;
  const supabase = await createLearnClient();
  let query = supabase.from('track_offers').select('id').eq('user_id', user.id);
  query =
    'themeId' in parsed.data
      ? query.eq('theme_id', parsed.data.themeId)
      : query.eq('subject_id', parsed.data.subjectId).eq('kind', 'resting');
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  const id = data?.[0]?.id as string | undefined;
  if (!id) return;
  const { error: deleteError } = await supabase
    .from('track_offers')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (deleteError) throw new Error(deleteError.message);
}
