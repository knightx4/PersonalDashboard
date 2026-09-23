'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Sprout } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { ProbeOptions } from '@/components/learn/probe-options';
import { trackChange, trackPercent, type TrackMove } from '@/lib/learn/flow/track';
import {
  answerTrackOffer,
  fillFlowQueue,
  flowStep,
  type FlowState,
} from './actions';
import type { TrackOffer } from './state';

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

const NOTHING_TO_ASK: Record<NonNullable<FlowState['nothing']>, string> = {
  'no-subjects': 'No tracks yet, so there is nothing to ask about. Name one first.',
  'all-settled': 'Every idea in every track is known. Nothing left to ask.',
};

function AskButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  // Usually the next question was written ahead and comes straight back. The
  // wait is only long when the queue ran dry and it is being written now.
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Getting the next question…' : label}
    </Button>
  );
}

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
        aria-label={name ? `Ideas known in ${name}` : 'Ideas known in this track'}
      >
        <div
          className={cn(
            'h-full rounded-pill transition-[width] duration-700 ease-out motion-reduce:transition-none',
            fell ? 'bg-danger' : 'bg-accent',
          )}
          style={{ width: `${shown}%` }}
        />
      </div>
      <p className="mt-1 text-small text-ink-muted">{trackChange(move)}</p>
    </div>
  );
}

/**
 * "I don't know" (note a62b132f): a submit on the answer form carrying no
 * index. It counts as a miss, and the right answer and its reason come back
 * the same as after a wrong pick.
 */
function DontKnowButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="dontKnow"
      value="1"
      disabled={pending}
      className="text-ui text-ink-muted underline-offset-2 hover:text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-70"
    >
      I don&rsquo;t know
    </button>
  );
}

/**
 * Not now (note 7ccc6f99): the question goes back to the end of the queue with
 * nothing recorded against it, and the next one comes up. On the answer form
 * so it sits beside I don't know, and told apart by its own field.
 */
function NotNowButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="notNow"
      value="1"
      disabled={pending}
      className="text-ui text-ink-muted underline-offset-2 hover:text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-70"
    >
      Not now
    </button>
  );
}

function StartButton() {
  const { pending } = useFormStatus();
  // One call to write the track's ideas and one to write its first question,
  // so this is the slowest press in the flow and says so.
  return (
    <Button type="submit" variant="secondary" size="sm" disabled={pending}>
      {pending ? 'Writing the track…' : 'Start'}
    </Button>
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
}: {
  offer: TrackOffer;
  error?: string;
  step: (formData: FormData) => void;
  track: FlowTrack;
}) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  const setAside = async (formData: FormData) => {
    setHidden(true);
    await answerTrackOffer(formData);
  };

  return (
    <div className="mt-4 flex gap-3 text-left">
      <Sprout className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={2} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-ui font-medium text-ink">New track: {offer.name}</p>
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
            <TrackField track={track} />
            <StartButton />
          </form>
          {(['not_now', 'never'] as const).map((outcome) => (
            <form key={outcome} action={setAside}>
              <input type="hidden" name="themeId" value={offer.themeId} />
              <input type="hidden" name="outcome" value={outcome} />
              <button
                type="submit"
                className="text-ui text-ink-muted underline-offset-2 hover:text-accent hover:underline"
              >
                {outcome === 'never' ? 'Never' : 'Not now'}
              </button>
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
 */
function TrackField({ track }: { track: FlowTrack }) {
  return <input type="hidden" name="track" value={track?.id ?? ''} />;
}

export function FlowSession({ first, track }: { first: FlowState; track: FlowTrack }) {
  const [live, step] = useActionState<FlowState, FormData>(flowStep, first);
  const trackId = track?.id ?? null;

  // Once per visit: the queue may have run down while you were away, and
  // filling it now means the question after this one is ready in time.
  useEffect(() => {
    void fillFlowQueue(trackId);
  }, [trackId]);

  if (!live.question || !live.options) {
    // Nothing left to ask, and a theme from your notes to start on: the offer
    // is the way on, so it is the whole card rather than a line under it.
    if (live.nothing && live.offer) {
      return (
        <div className={cn(cardVariants(), 'border-dashed px-4 py-6')}>
          <p className="text-ui text-ink-muted">{NOTHING_TO_ASK[live.nothing]}</p>
          <TrackOfferCard
            key={live.offer.themeId}
            offer={live.offer}
            error={live.offerError}
            step={step}
            track={track}
          />
        </div>
      );
    }
    return (
      <form action={step} className={cn(cardVariants(), 'border-dashed px-4 py-6 text-center')}>
        <input type="hidden" name="intent" value="ask" />
        <TrackField track={track} />
        <div className="flex flex-wrap items-center justify-center gap-3">
          {live.error && <AskButton label="Try again" />}
          {live.nothing && (
            <span className="text-ui text-ink-muted">
              {track ? `Nothing left to ask about ${track.name}.` : NOTHING_TO_ASK[live.nothing]}
            </span>
          )}
          {live.nothing && track && (
            <Link href="/learn/flow" className="text-ui text-accent hover:underline">
              Ask across all tracks
            </Link>
          )}
          {live.error && <span className="text-ui text-danger">{live.error}</span>}
        </div>
      </form>
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
      </p>
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
      <p className="mt-1 text-body text-ink">{live.question}</p>

      <form action={step} className="mt-4 space-y-2">
        <input type="hidden" name="intent" value="answer" />
        <TrackField track={track} />
        <input type="hidden" name="probeId" value={live.probeId} />
        <input type="hidden" name="conceptId" value={live.conceptId} />
        <input type="hidden" name="subjectId" value={live.subjectId} />

        <ProbeOptions options={live.options} answered={live.answered ?? null} />
        {!live.answered && (
          <div className="flex flex-wrap items-center gap-4 pt-1">
            <DontKnowButton />
            <NotNowButton />
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

          {live.answered.misconception && (
            <p className="mt-3 border-l-2 border-danger pl-3 text-body text-ink">
              You have picked this one twice now. {live.answered.misconception}
            </p>
          )}

          {/* Keyed by the question, so each answer mounts a new bar that starts
              at the old width instead of reusing the last one's. */}
          {live.track && (
            <TrackBar key={live.probeId} name={live.subjectName} move={live.track} />
          )}

          {live.offer && (
            <TrackOfferCard
              key={`${live.probeId}:${live.offer.themeId}`}
              offer={live.offer}
              error={live.offerError}
              step={step}
              track={track}
            />
          )}

          <form action={step} className="mt-4">
            <input type="hidden" name="intent" value="ask" />
            <TrackField track={track} />
            <AskButton label="Next" />
          </form>
        </div>
      )}

      {live.error && <p className="mt-3 text-ui text-danger">{live.error}</p>}
    </div>
  );
}
