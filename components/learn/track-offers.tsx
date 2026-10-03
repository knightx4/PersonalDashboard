'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Moon, Sprout } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PaidHint } from '@/components/ui/paid-hint';
import { cn } from '@/lib/cn';
import type { TrackOffer } from '@/lib/learn/flow/offer';
import { weeksResting, type RestingOffer } from '@/lib/learn/lessons/resting';
import { answerTrackOffer } from '@/app/learn/flow/actions';
import {
  answerRestingTrack,
  startTrackOffer,
  type NewTrackResult,
} from '@/app/learn/now/actions';

type MadeTrack = NonNullable<NewTrackResult['track']>;

/**
 * The one track offer a visit to Tracks carries (note 8a1789df; it used to
 * come up in the Learn now deck). A track you have left alone (plan #1045)
 * goes first, and a visit that offers one offers no theme; otherwise the
 * strongest theme in your notes with no track (plan #968). Nothing records
 * that it was shown, so the next visit offers whatever a press here left.
 *
 * Once it is answered the card goes, leaving a line for a track started or
 * picked up, and the page is read again so the list above shows it.
 */
export function TrackOffers({
  offer,
  resting,
}: {
  offer: TrackOffer | null;
  resting: RestingOffer | null;
}) {
  const router = useRouter();
  const [shownResting, setResting] = useState(resting);
  const [shownOffer, setOffer] = useState(resting ? null : offer);
  const [started, setStarted] = useState<MadeTrack | null>(null);
  const [pickedUp, setPickedUp] = useState<RestingOffer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const offerDone = (track: MadeTrack | null) => {
    setOffer(null);
    if (track) {
      setStarted(track);
      router.refresh();
    }
  };
  const restingDone = (picked: RestingOffer | null) => {
    setResting(null);
    if (picked) {
      setPickedUp(picked);
      router.refresh();
    }
  };

  if (!shownResting && !shownOffer && !started && !pickedUp && !error) return null;
  return (
    <div className="mb-4 space-y-2">
      {error && (
        <p className="text-small text-danger" role="alert">
          {error}
        </p>
      )}
      {started && <MadeTrackLine track={started} />}
      {pickedUp && (
        <p className="text-small text-ink-muted" aria-live="polite">
          Picked up{' '}
          <Link href={`/learn/s/${pickedUp.subjectId}`} className="text-ink underline underline-offset-2">
            {pickedUp.name}
          </Link>
          . Its lessons come back into Learn now from the next cards written.
        </p>
      )}
      {shownResting ? (
        <RestingTrackCard
          key={shownResting.subjectId}
          track={shownResting}
          onDone={restingDone}
          onError={setError}
        />
      ) : shownOffer ? (
        <FeedOfferCard key={shownOffer.themeId} offer={shownOffer} onDone={offerDone} />
      ) : null}
    </div>
  );
}

/** The line a new track leaves: its name, linked, and where its lessons will come. */
export function MadeTrackLine({ track, className }: { track: MadeTrack; className?: string }) {
  return (
    <p className={cn('text-small text-ink-muted', className)} aria-live="polite">
      Started{' '}
      <Link href={`/learn/s/${track.id}`} className="text-ink underline underline-offset-2">
        {track.name}
      </Link>
      {track.units > 0
        ? `, ${track.units} units. Its lessons come into Learn now as they are written.`
        : '. Its units could not be written yet; its page can write them.'}
    </p>
  );
}

/**
 * A theme from your notes offered as a new track (LEARN-LESSONS-SPEC, "What
 * the feed deals"; plan #968). Start writes the track with its units; Not now
 * and Never go through Practice Flow's own action, so a theme set aside here
 * is set aside there too.
 */
function FeedOfferCard({
  offer,
  onDone,
}: {
  offer: TrackOffer;
  onDone: (track: MadeTrack | null) => void;
}) {
  const [starting, startStart] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const start = () =>
    startStart(async () => {
      setError(null);
      const result: NewTrackResult = await startTrackOffer(offer.themeId).catch(() => ({
        error: 'Could not start that subject. Check your connection.',
      }));
      if (result.track) onDone(result.track);
      else setError(result.error ?? 'Could not start that subject.');
    });

  const setAside = (outcome: 'not_now' | 'never') => {
    onDone(null);
    const form = new FormData();
    form.set('themeId', offer.themeId);
    form.set('outcome', outcome);
    // As in Practice Flow: the card has gone, and a press that was not kept
    // only means the theme may be offered again.
    void answerTrackOffer(form).catch(() => undefined);
  };

  return (
    <Card padding="standard">
      <p className="flex items-center gap-1.5 text-small text-ink-muted">
        <Sprout className="size-3.5" strokeWidth={2} aria-hidden />
        A new subject
      </p>
      <h2 className="mt-1 font-display text-title tracking-tight break-words text-ink">
        {offer.name}
      </h2>
      <p className="mt-2 text-body text-ink">
        You write a lot about this, in {offer.notes} of your {offer.notes === 1 ? 'note' : 'notes'}.
        Want a curriculum for it?
      </p>
      {offer.about && <p className="mt-2 text-ui text-ink-muted">{offer.about}</p>}
      {offer.field && (
        <p className="mt-1 text-ui text-ink-muted">
          It sits in {offer.field}, which you write about most and have never been tested in.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1">
          <Button type="button" variant="primary" onClick={start} pending={starting}>
            {starting ? 'Writing the subject…' : 'Start'}
          </Button>
          <PaidHint
            action="app/learn/now/actions.ts#startTrackOffer"
            what="Cost of starting the subject"
          />
        </span>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setAside('not_now')}
          disabled={starting}
        >
          Not now
        </Button>
        <Button type="button" variant="ghost" onClick={() => setAside('never')} disabled={starting}>
          Never
        </Button>
      </div>

      {starting && (
        <p className="mt-2 text-small text-ink-muted" aria-live="polite">
          Writing the subject&apos;s first ideas and its units. This takes about a minute.
        </p>
      )}
      {error && <p className="mt-2 text-small text-danger">{error}</p>}
    </Card>
  );
}

/**
 * A track you have left alone, offered back (LEARN-LESSONS-SPEC, "A resting
 * track is offered back"; plan #1045). Pick it up waits for the press to be
 * kept, since the track's lessons hang on it; Not now and Let it rest take the
 * card away at once, and one that was not kept only means the track may be
 * offered again.
 */
function RestingTrackCard({
  track,
  onDone,
  onError,
}: {
  track: RestingOffer;
  onDone: (picked: RestingOffer | null) => void;
  onError: (message: string) => void;
}) {
  const [picking, startPicking] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const weeks = weeksResting(track.lastUsed, new Date());

  const pickUp = () =>
    startPicking(async () => {
      setError(null);
      const result = await answerRestingTrack(track.subjectId, 'picked_up').catch(() => ({
        error: 'Could not pick that subject up. Check your connection.',
      }));
      if (result.error) setError(result.error);
      else onDone(track);
    });

  const setAside = (outcome: 'not_now' | 'rested') => {
    onDone(null);
    void answerRestingTrack(track.subjectId, outcome)
      .then((result) => {
        if (result.error) onError(`That was not kept: ${result.error}`);
      })
      .catch(() => onError('That was not kept. Check your connection.'));
  };

  return (
    <Card padding="standard">
      <p className="flex items-center gap-1.5 text-small text-ink-muted">
        <Moon className="size-3.5" strokeWidth={2} aria-hidden />
        A resting subject
      </p>
      <h2 className="mt-1 font-display text-title tracking-tight break-words text-ink">
        <Link href={`/learn/s/${track.subjectId}`} className="hover:underline underline-offset-2">
          {track.name}
        </Link>
      </h2>
      <p className="mt-2 text-body text-ink">
        You have left this alone for {weeks} {weeks === 1 ? 'week' : 'weeks'}, so its lessons stopped
        coming. Pick it up again?
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="button" variant="primary" onClick={pickUp} pending={picking}>
          Pick it up
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setAside('not_now')}
          disabled={picking}
        >
          Not now
        </Button>
        <Button type="button" variant="ghost" onClick={() => setAside('rested')} disabled={picking}>
          Let it rest
        </Button>
      </div>
      {error && <p className="mt-2 text-small text-danger">{error}</p>}
    </Card>
  );
}
