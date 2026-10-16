'use client';

import { closedToast } from '@/lib/core/lifecycle';
import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sprout } from 'lucide-react';
import { DashAction } from '@/components/ui/dash-action';
import { PaidHint } from '@/components/ui/paid-hint';
import { cardVariants } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';
import { ProbeOptions } from '@/components/learn/probe-options';
import { LinkedText } from '@/components/ui/linked-text';
import { WrittenAnswer } from '@/components/learn/written-answer';
import { trackChange, trackPercent, type TrackMove } from '@/lib/learn/flow/track';
import { practiceHref } from '@/lib/learn/flow/href';
import { AskButton, DontKnowButton, EndHereButton, NotNowButton } from './buttons';
import { RunSummaryPanel } from './summary-card';
import { Button } from '@/components/ui/button';
import { ExplainCard } from './explain-card';
import {
  answerTrackOffer,
  fillFlowQueue,
  flowStep,
  takeBackOfferAnswer,
  type FlowState,
} from './actions';
import type { TrackOffer } from './state';
import { CloseButton } from '@/components/inbox/close-button';
import { useToast } from '@/components/ui/toast';

/**
 * A question, the reason, and Next, for as long as you keep going.
 *
 * The page hands over the first question, so there is nothing to press before
 * it. Asking and answering share one action state, so the question on screen
 * is always the one the last submit returned. Next runs the pick again rather
 * than working through a list, which is what lets an answer that just settled
 * a claim change what is asked after it. It stops only when the pick has
 * nothing left.
 */

/** The track a focused flow asks about (plan #779). Null when it mixes. */
export type FlowTrack = { id: string; name: string } | null;

/** The goal a goal's Practise link asks about (plan #1387). Null otherwise. */
export type FlowGoal = { id: string; name: string } | null;

/**
 * The filter: Tracks only (plan #842), Goals only (plan #1387), or null for
 * everything. Unused when the flow is focused on a track or a goal.
 */
export type FlowOnly = 'tracks' | 'goals' | null;

/** What to say when a goal-scoped flow has nothing left to ask. */
function nothingAboutGoals(goal: FlowGoal): string {
  return goal ? `Nothing left to ask about ${goal.name}.` : 'Nothing left to ask about your goals.';
}

const NOTHING_TO_ASK: Record<NonNullable<FlowState['nothing']>, string> = {
  'no-subjects': 'No subjects yet, so there is nothing to ask about. Name one first.',
  'all-settled': 'Every idea in every subject is known. Nothing left to ask.',
};

/**
 * The track the answer belonged to, and its bar moving from where it stood to
 * where the answer left it. Drawn at the old width first and moved on the next
 * frame, so the change is seen rather than only stated. Red when it fell,
 * because a bar that only ever goes up says nothing.
 */
function TrackBar({ name, move }: { name?: string; move: TrackMove }) {
  const [shown, setShown] = useState(trackPercent(move.before, move.total));
  const target = trackPercent(move.settled, move.total);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(target));
    return () => cancelAnimationFrame(frame);
  }, [target]);

  const fell = move.settled < move.before;
  return (
    <div className="mt-4">
      <p className="text-ui text-ink">
        {name ? `${name}, ` : ''}
        {move.settled} of {move.total} known
      </p>
      <div
        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-pill bg-sunken"
        role="progressbar"
        aria-valuenow={move.settled}
        aria-valuemin={0}
        aria-valuemax={move.total}
        aria-label={name ? `Ideas known in ${name}` : 'Ideas known in this subject'}
      >
        <div
          className={cn(
            'h-full rounded-pill transition-[width] duration-moment ease-out-soft motion-reduce:transition-none',
            fell ? 'bg-danger' : 'bg-accent',
          )}
          style={{ width: `${shown}%` }}
        />
      </div>
      <p className="mt-1 text-small text-ink-muted">{trackChange(move)}</p>
    </div>
  );
}

function StartButton() {
  const { pending } = useFormStatus();
  // One call to write the track's ideas and one to write its first question,
  // so this is the slowest press in the flow and says so.
  return (
    <DashAction
      type="submit"
      variant="secondary"
      size="sm"
      pending={pending}
      paid="app/learn/flow/actions.ts#flowStep:start-track"
      what="Cost of starting the subject"
    >
      {pending ? 'Writing the subject…' : 'Start this subject'}
    </DashAction>
  );
}

/**
 * A new track from a theme in your notes, offered when the flow is running
 * low (plan #778). Start writes the track and puts its first question on the
 * screen; Not now and Never hide the card here at once, and keep the theme
 * back for a few weeks or for good. When the theme came from the field you
 * write about most and have never been tested in, one line says so (#800).
 */
function TrackOfferCard({
  offer,
  error,
  step,
  track,
  only,
}: {
  offer: TrackOffer;
  error?: string;
  step: (formData: FormData) => void;
  track: FlowTrack;
  only: FlowOnly;
}) {
  const [hidden, setHidden] = useState(false);
  const toast = useToast();
  if (hidden) return null;

  // Later or Decline, with Undo in the toast (plan #1957.3).
  const setAside = async (formData: FormData) => {
    setHidden(true);
    await answerTrackOffer(formData);
    toast({
      text: closedToast(formData.get('outcome') === 'never' ? 'declined' : 'later', offer.name),
      undo: async () => {
        await takeBackOfferAnswer({ themeId: offer.themeId });
        setHidden(false);
      },
    });
  };

  return (
    <div className="flex w-full gap-3 text-left">
      <Sprout className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-ui font-medium text-ink">New subject: {offer.name}</p>
        <p className="mt-0.5 text-small text-ink-muted">
          From {offer.notes} of your {offer.notes === 1 ? 'note' : 'notes'}. {offer.about}
        </p>
        {offer.field && (
          <p className="mt-0.5 text-small text-ink-muted">
            You write a lot about {offer.field} and have never been tested in it.
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <form action={step}>
            <input type="hidden" name="intent" value="start-track" />
            <input type="hidden" name="themeId" value={offer.themeId} />
            <TrackField track={track} only={only} goal={null} />
            <StartButton />
          </form>
          {(['not_now', 'never'] as const).map((outcome) => (
            <form key={outcome} action={setAside}>
              <input type="hidden" name="themeId" value={offer.themeId} />
              <input type="hidden" name="outcome" value={outcome} />
              <CloseButton lifecycle={outcome === 'never' ? 'declined' : 'later'} type="submit" />
            </form>
          ))}
        </div>
        {error && <p className="mt-2 text-ui text-danger">{error}</p>}
      </div>
    </div>
  );
}

/**
 * Every form in the flow carries the focus, because the action reads the
 * form and nothing else: the next question and the queue topped up after it
 * both come from the track named here, or from all of them when it is empty.
 * `only` carries the Tracks only and Goals only filters (plans #842, #1387)
 * the same way, and `goal` the goal a goal's Practise link asks about.
 */
function TrackField({ track, only, goal }: { track: FlowTrack; only: FlowOnly; goal: FlowGoal }) {
  return (
    <>
      <input type="hidden" name="track" value={track?.id ?? ''} />
      {only && <input type="hidden" name="only" value={only} />}
      {goal && <input type="hidden" name="goal" value={goal.id} />}
    </>
  );
}

export function FlowSession({
  first,
  track,
  only = null,
  goal = null,
}: {
  first: FlowState;
  track: FlowTrack;
  /** The filter: Tracks only, Goals only, or null for everything. */
  only?: FlowOnly;
  /** The one goal asked about, from its Practise link. */
  goal?: FlowGoal;
}) {
  const [live, step] = useActionState<FlowState, FormData>(flowStep, first);
  const trackId = track?.id ?? null;
  const goalId = goal?.id ?? null;
  const aboutGoals = goal !== null || (track === null && only === 'goals');
  // End here (plan #2164.6) swaps the card for what the last hour moved.
  const [ended, setEnded] = useState(false);

  // Once per visit: the queue may have run down while you were away, and
  // filling it now means the question after this one is ready in time.
  useEffect(() => {
    void fillFlowQueue({ track: trackId, only, goal: goalId });
  }, [trackId, only, goalId]);

  if (ended) {
    return (
      <div className="space-y-4">
        <RunSummaryPanel
          foot={
            <Button type="button" size="lg" onClick={() => setEnded(false)}>
              Keep going
            </Button>
          }
        />
      </div>
    );
  }

  if (!live.question || !live.options) {
    // Nothing left to ask, and a theme from your notes to start on: the offer
    // is the way on, so it is the whole card rather than a line under it.
    if (live.nothing && live.offer) {
      return (
        <EmptyState size="box" align="start" title={NOTHING_TO_ASK[live.nothing]}>
          <TrackOfferCard
            key={live.offer.themeId}
            offer={live.offer}
            error={live.offerError}
            step={step}
            track={track}
            only={only}
          />
        </EmptyState>
      );
    }
    const nothingText = live.nothing
      ? track
        ? `Nothing left to ask about ${track.name}.`
        : aboutGoals
          ? nothingAboutGoals(goal)
          : NOTHING_TO_ASK[live.nothing]
      : null;
    return (
      <div className="space-y-4">
        <form action={step}>
          <input type="hidden" name="intent" value="ask" />
          <TrackField track={track} only={only} goal={goal} />
          <EmptyState
            size="box"
            title={nothingText ?? live.error ?? ''}
            action={
              live.nothing && track
                ? { label: 'Ask across all subjects', href: practiceHref() }
                : live.nothing && aboutGoals
                  ? { label: 'Ask about everything', href: practiceHref() }
                  : undefined
            }
          >
            {live.error && <AskButton label="Try again" />}
            {nothingText && live.error && <span className="text-ui text-danger">{live.error}</span>}
          </EmptyState>
        </form>
        {/* Nothing left to ask ends the run: say what it moved. */}
        {live.nothing && <RunSummaryPanel />}
      </div>
    );
  }

  // A goal question (plan #2164.2): explained in your own words and marked.
  if (live.explain) {
    return (
      <ExplainCard
        key={live.probeId}
        live={live}
        step={step}
        fields={<TrackField track={track} only={only} goal={goal} />}
        onEnd={() => setEnded(true)}
      />
    );
  }

  return (
    <div className={cardVariants({ padding: 'standard' })}>
      {live.started && (
        <p className="mb-2 text-ui text-ink">
          Started {live.started}. Its questions are mixed in with the rest from here on.
        </p>
      )}
      <p className="text-small text-ink-muted">
        {live.conceptName}
        {live.subjectName && ` · ${live.subjectName}`}
        {live.survey?.fieldName && ` · ${live.survey.fieldName}`}
      </p>
      {/* A survey question is about something you write about and have no
          track for (plan #842). Said so, because the subject named above is
          not in your list of tracks and would otherwise look like a mistake. */}
      {live.survey && (
        <p className="mt-0.5 text-small text-ink-muted">
          From a theme in your notes that is not one of your subjects.
        </p>
      )}
      {/* A goal question (plan #1385) is named after the goal above, which is
          not in your list of tracks either, so where it comes from is said. */}
      {live.goal && <p className="mt-0.5 text-small text-ink-muted">From your learning goals.</p>}
      {/* Said before the question rather than after the answer: being asked
          about something you settled months ago looks like the app having lost
          track until you know it is deliberate. Which of the two settled it is
          said as well, because a claim you only waved through has never been
          asked about at all and the question will read differently for it. */}
      {live.recheck && (
        <p className="mt-0.5 text-small text-ink-muted">
          {live.recheck === 'declared'
            ? 'A quick review. You said you knew this one a while ago.'
            : 'A quick review. You answered this one a while ago.'}
        </p>
      )}
      <p className="mt-1 whitespace-pre-line text-body text-ink">
        <LinkedText text={live.question} />
      </p>

      <form action={step} className="mt-4 space-y-2">
        <input type="hidden" name="intent" value="answer" />
        <TrackField track={track} only={only} goal={goal} />
        <input type="hidden" name="probeId" value={live.probeId} />
        <input type="hidden" name="conceptId" value={live.conceptId} />
        <input type="hidden" name="subjectId" value={live.subjectId} />

        {live.case ? (
          // A worked case (plan #2164.3): a number or two sentences, graded
          // as the applied rung is.
          <WrittenAnswer
            response={live.answered?.response ?? null}
            paid="app/learn/flow/actions.ts#flowStep:answer"
          />
        ) : (
          <ProbeOptions options={live.options} answered={live.answered ?? null} />
        )}
        {!live.answered && (
          <div className="flex flex-wrap items-center gap-4 pt-1">
            {!live.case && <DontKnowButton />}
            <span className="inline-flex items-center gap-1">
              <NotNowButton />
              {/* dash-action-ok: the hint sits beside the Later close button, which does not run the model. */}
              <PaidHint
                action="app/learn/flow/actions.ts#flowStep:ask"
                what="Cost of the next question"
              />
            </span>
          </div>
        )}
      </form>

      {live.answered && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-ui font-semibold text-ink">
            {live.answered.correct
              ? 'Right.'
              : live.answered.dontKnow
                ? 'Counted as a miss. The answer is ticked.'
                : 'Not this time.'}
          </p>
          {/* Written when the question was, not in response to what was
              picked. That is what makes it worth reading. */}
          <p className="mt-1 text-body text-ink">{live.answered.reason}</p>

          {live.answered.expected && (
            <>
              <p className="mt-3 text-small text-ink-muted">The answer expected</p>
              <p className="mt-0.5 text-body text-ink">{live.answered.expected}</p>
            </>
          )}

          {live.answered.misconception && (
            <p className="mt-3 border-l-2 border-danger pl-3 text-body text-ink">
              You have picked this one twice now. {live.answered.misconception}
            </p>
          )}

          {/* Keyed by the question, so each answer mounts a new bar that starts
              at the old width instead of reusing the last one's. */}
          {live.track && <TrackBar key={live.probeId} name={live.subjectName} move={live.track} />}

          {live.offer && (
            <TrackOfferCard
              key={`${live.probeId}:${live.offer.themeId}`}
              offer={live.offer}
              error={live.offerError}
              step={step}
              track={track}
              only={only}
            />
          )}

          <form action={step} className="mt-4">
            <input type="hidden" name="intent" value="ask" />
            <TrackField track={track} only={only} goal={goal} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <AskButton label="Next" />
              <EndHereButton onEnd={() => setEnded(true)} />
            </div>
          </form>
        </div>
      )}

      {live.error && <p className="mt-3 text-ui text-danger">{live.error}</p>}
    </div>
  );
}
