'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { ProbeOptions } from '@/components/learn/probe-options';
import { trackChange, trackPercent, type TrackMove } from '@/lib/learn/flow/track';
import { fillFlowQueue, flowStep, pushReadingAside, type FlowState } from './actions';
import type { FlowReading } from './state';

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
  'no-subjects': 'No subjects yet, so there is nothing to ask about. Name one first.',
  'all-settled': 'Every claim in every subject is settled. Nothing left to ask.',
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
        {move.settled} of {move.total} settled
      </p>
      <div
        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-pill bg-sunken"
        role="progressbar"
        aria-valuenow={move.settled}
        aria-valuemin={0}
        aria-valuemax={move.total}
        aria-label={name ? `Ideas settled in ${name}` : 'Ideas settled in this track'}
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
 * A reading you queued and never opened, offered under the answer. What Learn
 * next listed before the flow took that page over (plan #773). Not now hides
 * it here at once and keeps it out of the offer for a few weeks.
 */
function ReadingOffer({ reading }: { reading: FlowReading }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  return (
    <div className="mt-4 flex gap-3">
      <BookOpen className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={2} aria-hidden />
      <div className="min-w-0 flex-1">
        <Link
          href={`/learn/r/${reading.id}`}
          className="text-ui font-medium text-ink hover:text-accent"
        >
          {reading.title}
        </Link>
        <p className="mt-0.5 text-small text-ink-muted">{reading.reason}</p>
      </div>
      <form
        action={async (formData) => {
          setHidden(true);
          await pushReadingAside(formData);
        }}
      >
        <input type="hidden" name="readingId" value={reading.id} />
        <button
          type="submit"
          className="text-ui text-ink-muted underline-offset-2 hover:text-accent hover:underline"
        >
          Not now
        </button>
      </form>
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
            <Link href="/learn" className="text-ui text-accent hover:underline">
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
            ? 'A re-check — you said you knew this one a while ago.'
            : 'A re-check — you answered about this one a while ago.'}
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
      </form>

      {live.answered && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-ui font-semibold text-ink">
            {live.answered.correct ? 'Right.' : 'Not this time.'}
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

          {live.reading && <ReadingOffer key={live.probeId} reading={live.reading} />}

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
