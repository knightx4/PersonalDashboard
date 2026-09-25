'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ExternalLink,
  Feather,
  GraduationCap,
  Moon,
  Sprout,
  Weight,
  X,
} from 'lucide-react';
import { ClipPlayer } from '@/components/learn/clip-player';
import { Button } from '@/components/ui/button';
import { PaidHint } from '@/components/ui/paid-hint';
import { Card } from '@/components/ui/card';
import { Field, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import {
  appendCards,
  canMakeTrack,
  feedEnd,
  offerDue,
  type CardDifficulty,
  PRELOAD_AHEAD,
  type FeedCard,
  type SwipeAction,
} from '@/lib/learn/feed/card';
import type { TrackOffer } from '@/lib/learn/flow/offer';
import { weeksResting, type RestingOffer } from '@/lib/learn/lessons/resting';
import { answerTrackOffer } from '../flow/actions';
import {
  answerRestingTrack,
  answerUnitCheck,
  dismissCard,
  loadMoreCards,
  makeTrackOfCard,
  openCardSource,
  rateCard,
  saveCard,
  startTrackOffer,
  swipeCard,
  testMeOnCard,
  type NewTrackResult,
  type UnitCheckResult,
} from './actions';

/**
 * The Learn now deck (LEARN-NOW-SPEC, "Cards after the first week").
 *
 * One card on the screen at a time, left by one of three swipes:
 *
 *   down    Got it: "I'm good on this". The next picks on its theme go deeper.
 *   right   Work on this: it comes back in two days, and its theme sooner.
 *   left    Not now: it comes back in three days.
 *
 * On a phone the card is swiped; on a laptop the arrow keys do the same, and
 * the three buttons at the foot of the card work everywhere. A downward swipe
 * only counts from the top of the page, since further down the same gesture
 * is scrolling back up.
 *
 * The next cards are already loaded behind the one on screen, and more are
 * asked for while four are still ahead, so moving on never waits for the
 * network. Recording a swipe happens after the card has gone.
 *
 * A visit may also carry one track offer (plan #968), shown in place of the
 * next card once a couple are passed. It has no swipes: it stays until Start,
 * Not now or Never is pressed, as the offer in Practice Flow does. A track you
 * have left alone (plan #1045) takes the same place, with Pick it up, Not now
 * and Let it rest, and a visit that carries one carries no theme offer.
 *
 * A unit check (plan #971) has no swipes either: it is answered or skipped.
 */

const SWIPE_X = 90;
const SWIPE_Y = 110;
const LEAVE_MS = 180;

type Leaving = { id: string; swipe: SwipeAction } | null;

const SWIPE_LABEL: Record<SwipeAction, string> = {
  known: 'Got it',
  review: 'Work on this',
  skipped: 'Not now',
};

type MadeTrack = NonNullable<NewTrackResult['track']>;

export function LearnNowFeed({
  first,
  ready: firstReady,
  low,
  offer: firstOffer = null,
  resting: firstResting = null,
}: {
  first: FeedCard[];
  ready: number;
  /** Below this many ready cards, loading more starts a top-up. */
  low: number;
  /** A theme from your notes to offer as a new track this visit, or null. */
  offer?: TrackOffer | null;
  /** A dormant track to offer back this visit, or null. It goes before a theme. */
  resting?: RestingOffer | null;
}) {
  const [resting, setResting] = useState(firstResting);
  // One offer a visit: a resting track and a theme are never both on it.
  const [offer, setOffer] = useState(firstResting ? null : firstOffer);
  const [pickedUp, setPickedUp] = useState<RestingOffer | null>(null);
  const [started, setStarted] = useState<MadeTrack | null>(null);
  const [deck, setDeck] = useState(first);
  const [ready, setReady] = useState(firstReady);
  const [ended, setEnded] = useState(first.length === 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<Leaving>(null);
  const [passed, setPassed] = useState(0);
  const loaded = useRef(first.map((card) => card.id));
  const busy = useRef(false);
  const top = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const more = await loadMoreCards(loaded.current);
      loaded.current = [...loaded.current, ...more.cards.map((card) => card.id)];
      setDeck((current) => appendCards(current, more.cards));
      setReady(more.ready);
      setEnded(more.cards.length === 0);
    } catch {
      setError('Could not load more cards. Try again in a moment.');
      setEnded(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  // Keep the deck stocked: ask for more while a few cards are still ahead.
  useEffect(() => {
    if (!ended && deck.length <= PRELOAD_AHEAD) void loadMore();
  }, [deck.length, ended, loadMore]);

  const current = deck[0] ?? null;
  const offerShown = (offer !== null || resting !== null) && offerDue(passed, deck.length);

  const offerDone = useCallback((track: MadeTrack | null) => {
    setOffer(null);
    if (track) setStarted(track);
  }, []);

  const restingDone = useCallback((picked: RestingOffer | null) => {
    setResting(null);
    if (picked) setPickedUp(picked);
  }, []);

  /** Take the card off the top of the deck, and bring the next into view. */
  const advance = useCallback((id: string) => {
    setLeaving(null);
    setDeck((cards) => cards.filter((card) => card.id !== id));
    setPassed((count) => count + 1);
    const box = top.current;
    if (box && box.getBoundingClientRect().top < 0) box.scrollIntoView({ block: 'start' });
  }, []);

  const swipe = useCallback(
    (swipeAs: SwipeAction) => {
      if (!current || leaving) return;
      setError(null);
      const id = current.id;
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      setLeaving({ id, swipe: swipeAs });
      window.setTimeout(() => advance(id), reduced ? 0 : LEAVE_MS);
      void swipeCard(id, swipeAs)
        .then((result) => {
          if (result.error) setError(`That card was not recorded: ${result.error}`);
        })
        .catch(() => setError('That card was not recorded. Check your connection.'));
    },
    [advance, current, leaving],
  );

  const dismiss = useCallback(() => {
    if (!current) return;
    const id = current.id;
    setError(null);
    advance(id);
    void dismissCard(id)
      .then((result) => {
        if (result.error) setError(`Not interested was not recorded: ${result.error}`);
      })
      .catch(() => setError('Not interested was not recorded. Check your connection.'));
  }, [advance, current]);

  /** Skip on a unit check: it goes as Not interested does, and the unit stays done. */
  const skipCheck = useCallback(() => {
    if (!current) return;
    const id = current.id;
    setError(null);
    advance(id);
    void dismissCard(id)
      .then((result) => {
        if (result.error) setError(`Skipping that check was not recorded: ${result.error}`);
      })
      .catch(() => setError('Skipping that check was not recorded. Check your connection.'));
  }, [advance, current]);

  // The arrow keys, away from anything you are typing in.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const swipeAs: SwipeAction | null =
        event.key === 'ArrowDown'
          ? 'known'
          : event.key === 'ArrowRight'
            ? 'review'
            : event.key === 'ArrowLeft'
              ? 'skipped'
              : null;
      // The offer and a unit check have no swipes; their buttons are the only way past.
      if (!swipeAs || !current || offerShown || current.kind === 'check') return;
      event.preventDefault();
      swipe(swipeAs);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, offerShown, swipe]);

  const end = feedEnd(ready, low);
  const ahead = Math.max(0, deck.length - 1);

  return (
    <div ref={top} className="scroll-mt-4">
      {error && (
        <p className="mb-2 text-small text-danger" role="alert">
          {error}
        </p>
      )}
      {started && <MadeTrackLine track={started} className="mb-2" />}
      {pickedUp && (
        <p className="mb-2 text-small text-ink-muted" aria-live="polite">
          Picked up{' '}
          <Link href={`/learn/s/${pickedUp.subjectId}`} className="text-ink underline underline-offset-2">
            {pickedUp.name}
          </Link>
          . Its lessons come back into Learn now from the next cards written.
        </p>
      )}

      {resting && offerShown ? (
        <RestingTrackCard key={resting.subjectId} track={resting} onDone={restingDone} onError={setError} />
      ) : offer && offerShown ? (
        <FeedOfferCard key={offer.themeId} offer={offer} onDone={offerDone} />
      ) : current ? (
        <>
          <p
            className="mb-2 flex items-baseline justify-between gap-3 text-small text-ink-muted"
            aria-live="polite"
          >
            <span>
              {passed > 0
                ? `${passed} done this visit`
                : 'Swipe down if you know it, right to work on it, left for later.'}
            </span>
            <span className="shrink-0">
              {ahead > 0 ? `${ahead} more loaded` : loading ? 'Loading more…' : ''}
            </span>
          </p>
          {current.kind === 'check' ? (
            <UnitCheckCard
              key={current.id}
              card={current}
              onSkip={skipCheck}
              onNext={() => advance(current.id)}
            />
          ) : (
            <DeckCard
              key={current.id}
              card={current}
              leaving={leaving?.id === current.id ? leaving.swipe : null}
              onSwipe={swipe}
              onDismiss={dismiss}
            />
          )}
        </>
      ) : (
        <Card padding="standard" className="text-center">
          {loading ? (
            <p className="text-ui text-ink-muted" aria-live="polite">
              Loading cards…
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-ui text-ink-muted">
                {end === 'writing'
                  ? passed === 0
                    ? 'No cards are ready yet. New ones are being written from what you write about, a few minutes each.'
                    : 'You are through every card ready now. More are being written, a few minutes each.'
                  : 'You are through every card ready now. Cards you skipped come back in three days, and ones you want to work on in two.'}
              </p>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEnded(false);
                  setError(null);
                  void loadMore();
                }}
              >
                Check again
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

const DEPTH_LABEL: Record<NonNullable<FeedCard['depth']>, string> = {
  working: 'Past the basics',
  advanced: 'Advanced',
  specialist: 'Specialist',
};

type Drag = { x: number; y: number };

/** Minutes the whole section takes to read, at 230 words a minute. */
function readingMinutes(card: FeedCard): number {
  const words = [...card.shown, ...card.rest].join(' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 230));
}

/** Which swipe a drag is heading for, once it is far enough to show. */
function heading(drag: Drag | null): SwipeAction | null {
  if (!drag) return null;
  if (Math.abs(drag.x) >= Math.abs(drag.y)) {
    if (drag.x > SWIPE_X / 2) return 'review';
    if (drag.x < -SWIPE_X / 2) return 'skipped';
    return null;
  }
  return drag.y > SWIPE_Y / 2 ? 'known' : null;
}

function DeckCard({
  card,
  leaving,
  onSwipe,
  onDismiss,
}: {
  card: FeedCard;
  leaving: SwipeAction | null;
  onSwipe: (swipe: SwipeAction) => void;
  onDismiss: () => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [saved, setSaved] = useState<{ id: string; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();
  const [making, startMake] = useTransition();
  const [made, setMade] = useState<MadeTrack | null>(null);
  const [difficulty, setDifficulty] = useState<CardDifficulty | null>(card.difficulty);
  const rating = useRef(0);
  const surface = useRef<HTMLDivElement>(null);
  const swipeRef = useRef(onSwipe);
  useEffect(() => {
    swipeRef.current = onSwipe;
  }, [onSwipe]);

  // Touch listeners, attached by hand so the move handler can be non-passive:
  // it has to cancel the page's own scroll once a drag is claimed as a swipe.
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    let start: { x: number; y: number } | null = null;
    let axis: 'x' | 'y' | 'none' | null = null;
    let last: Drag = { x: 0, y: 0 };

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const target = event.target as HTMLElement | null;
      // Buttons, links and the folds keep their own taps.
      if (target?.closest('button, a, summary, input, textarea')) return;
      start = { x: event.touches[0]!.clientX, y: event.touches[0]!.clientY };
      axis = null;
      last = { x: 0, y: 0 };
    };
    const onMove = (event: TouchEvent) => {
      if (!start) return;
      const dx = event.touches[0]!.clientX - start.x;
      const dy = event.touches[0]!.clientY - start.y;
      if (axis === null) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (Math.abs(dx) > Math.abs(dy)) axis = 'x';
        // Down counts as a swipe only from the top of the page. Anywhere
        // else it is scrolling back up.
        else if (dy > 0 && window.scrollY <= 0) axis = 'y';
        else axis = 'none';
      }
      if (axis === 'none') return;
      event.preventDefault();
      last = axis === 'x' ? { x: dx, y: 0 } : { x: 0, y: Math.max(0, dy) };
      setDrag(last);
    };
    const onEnd = () => {
      if (!start) return;
      const claimed = axis;
      start = null;
      axis = null;
      setDrag(null);
      if (claimed === 'x' && Math.abs(last.x) >= SWIPE_X)
        swipeRef.current(last.x > 0 ? 'review' : 'skipped');
      else if (claimed === 'y' && last.y >= SWIPE_Y) swipeRef.current('known');
    };

    element.addEventListener('touchstart', onStart, { passive: true });
    element.addEventListener('touchmove', onMove, { passive: false });
    element.addEventListener('touchend', onEnd);
    element.addEventListener('touchcancel', onEnd);
    return () => {
      element.removeEventListener('touchstart', onStart);
      element.removeEventListener('touchmove', onMove);
      element.removeEventListener('touchend', onEnd);
      element.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  const save = () =>
    startSave(async () => {
      setError(null);
      const result = await saveCard(card.id);
      if (result.list) setSaved(result.list);
      else setError(result.error ?? 'Could not save that.');
    });

  const testMe = () =>
    startTest(async () => {
      setError(null);
      // Redirects to Practice Flow on success, so only a failure comes back.
      const result = await testMeOnCard(card.id);
      if (result?.error) setError(result.error);
    });

  const makeTrack = () =>
    startMake(async () => {
      setError(null);
      const result = await makeTrackOfCard(card.id).catch(() => ({
        error: 'Could not make that track. Check your connection.',
        track: undefined,
      }));
      if (result.track) setMade(result.track);
      else setError(result.error ?? 'Could not make that track.');
    });

  // Too hard and Too easy (plan #893). The card stays on screen (#891), so
  // the button shows as pressed at once and goes back if the write fails.
  // Pressing the one already pressed takes the rating back.
  const rate = (pressed: CardDifficulty) => {
    const before = difficulty;
    const next = before === pressed ? null : pressed;
    const request = ++rating.current;
    setError(null);
    setDifficulty(next);
    const failed = (reason: string) => {
      if (request !== rating.current) return;
      setDifficulty(before);
      setError(reason);
    };
    void rateCard(card.id, next)
      .then((result) => {
        if (result.error) failed(`That rating was not recorded: ${result.error}`);
      })
      .catch(() => failed('That rating was not recorded. Check your connection.'));
  };

  const toward = leaving ?? heading(drag);
  const transform = leaving
    ? leaving === 'known'
      ? 'translate(0, 70vh)'
      : `translate(${leaving === 'review' ? '' : '-'}120vw, 0) rotate(${leaving === 'review' ? 8 : -8}deg)`
    : drag
      ? `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x / 24}deg)`
      : undefined;

  return (
    <div
      ref={surface}
      className={cn(
        'relative select-none sm:select-auto',
        !drag && 'transition-[transform,opacity] duration-200 ease-out',
        leaving && 'opacity-0',
      )}
      style={{ transform }}
    >
      {toward && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-0 top-3 z-over-link mx-auto w-fit rounded-pill px-3 py-1 text-ui font-semibold',
            toward === 'known' && 'bg-positive-tint text-positive',
            toward === 'review' && 'bg-caution-tint text-caution',
            toward === 'skipped' && 'bg-sunken text-ink-muted',
          )}
        >
          {SWIPE_LABEL[toward]}
        </div>
      )}

      <Card padding="none">
        <article className="card-pad min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-small text-ink-muted">
            <span>{card.why}</span>
            {card.depth && (
              <span className="rounded-pill bg-sunken px-1.5 py-0.5 text-small text-ink-muted">
                {DEPTH_LABEL[card.depth]}
              </span>
            )}
            {card.returning === 'review' && (
              <span className="rounded-pill bg-caution-tint px-1.5 py-0.5 text-small text-caution">
                Back because you wanted to work on it
              </span>
            )}
            {card.returning === 'skipped' && (
              <span className="rounded-pill bg-sunken px-1.5 py-0.5 text-small text-ink-muted">
                Back after you skipped it
              </span>
            )}
          </p>
          <h2 className="mt-1 font-display text-title tracking-tight break-words text-ink">
            {card.title}
          </h2>
          {/* An idea card is titled by its idea, so the section it came from
              is named under it. A lesson names its track and unit there. */}
          {card.source && (
            <p className="mt-0.5 text-small text-ink-muted">
              {card.kind === 'lesson' ? card.source : `From ${card.source}`}
            </p>
          )}

          {/* The one thing to remember, first, for someone who reads no
              further (note 125f60f2). Older cards have none. */}
          {card.takeaway && (
            <section className="mt-3 rounded-control border-l-2 border-accent bg-accent-tint px-3 py-2.5">
              <h3 className="text-small font-semibold text-accent">The takeaway</h3>
              <p className="mt-1 text-body font-medium text-ink">{card.takeaway}</p>
            </section>
          )}

          {/* What this is about, before anything argues about it: the card
              has to stand on its own for someone who never saw the source. */}
          {card.context && <p className="mt-3 text-body text-ink">{card.context}</p>}
          {card.hook && <p className="mt-3 text-body font-semibold text-ink">{card.hook}</p>}
          <p className="mt-2 text-body text-ink">{card.summary}</p>

          {card.example && (
            <section className="mt-4 rounded-control bg-accent-tint px-3 py-2.5">
              <h3 className="text-small font-semibold text-accent">In practice</h3>
              <p className="mt-1 text-body text-ink">{card.example}</p>
            </section>
          )}

          {/* A lecture clip close to this idea, when the YouTube library has
              one. It loads only when pressed: the deck preloads the cards
              behind this one, and a player each would load for nothing. */}
          {card.video && (
            <section className="mt-4">
              <h3 className="text-small font-semibold text-ink-muted">Watch it explained</h3>
              <ClipPlayer
                videoId={card.video.videoId}
                title={card.video.title}
                start={card.video.start}
                end={card.video.end}
                deferred
                className="mt-1.5"
              />
            </section>
          )}

          {card.question && card.answer && (
            <section className="mt-4">
              <h3 className="text-small font-semibold text-ink-muted">Try this</h3>
              <p className="mt-1 text-body text-ink">{card.question}</p>
              <details className="group mt-2">
                <summary className="press inline-flex cursor-pointer list-none items-center rounded-control text-ui font-medium text-accent [&::-webkit-details-marker]:hidden">
                  <span className="group-open:hidden">Show the answer</span>
                  <span className="hidden group-open:inline">Answer</span>
                </summary>
                <p className="mt-1 text-body text-ink">{card.answer}</p>
              </details>
            </section>
          )}

          {/* The source's own text, folded: the card above is what to read
              first, and this is there for when you want the whole section.
              A lesson that cites no section has none. */}
          {card.shown.length > 0 && (
            <details className="group mt-4 border-t border-border pt-3">
              <summary className="press inline-flex cursor-pointer list-none items-center gap-1.5 rounded-control text-ui font-medium text-accent [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">Read the section</span>
                <span className="hidden group-open:inline">The section</span>
                <span className="font-normal text-ink-muted">{readingMinutes(card)} min</span>
              </summary>
              <div className="mt-2 space-y-3 text-body break-words text-ink">
                {[...card.shown, ...card.rest].map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>
            </details>
          )}

          {card.link && (
            <p className="mt-3 text-small text-ink-muted">
              <a
                href={card.link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => void openCardSource(card.id)}
                className="inline-flex items-center gap-1 text-ink underline underline-offset-2 hover:text-accent"
              >
                {card.article}
                <ExternalLink className="size-3" strokeWidth={2} aria-hidden />
              </a>
              {` · ${card.site}`}
              {card.licence ? ` · ${card.licence}` : ''}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {card.link && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={save}
                pending={saving}
                disabled={saved !== null}
              >
                {saved ? (
                  <Check className="size-3.5" strokeWidth={2} aria-hidden />
                ) : (
                  <Bookmark className="size-3.5" strokeWidth={2} aria-hidden />
                )}
                {saved ? 'Saved' : saving ? 'Saving…' : 'Save'}
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={testMe} pending={testing}>
              <GraduationCap className="size-3.5" strokeWidth={2} aria-hidden />
              {testing
                ? card.kind === 'lesson'
                  ? 'Opening Practice Flow…'
                  : 'Starting a track…'
                : 'Test me on this'}
            </Button>
            {/* A lesson's track already exists, so testing on it costs nothing. */}
            {card.kind === 'section' && (
              <PaidHint
                action="app/learn/now/actions.ts#testMeOnCard"
                what="Cost of starting a track from this card"
              />
            )}
            {canMakeTrack(card) && (
              <span className="inline-flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={makeTrack}
                  pending={making}
                  disabled={made !== null || testing}
                >
                  {made ? (
                    <Check className="size-3.5" strokeWidth={2} aria-hidden />
                  ) : (
                    <Sprout className="size-3.5" strokeWidth={2} aria-hidden />
                  )}
                  {made ? 'Track made' : making ? 'Making a track…' : 'Make this a track'}
                </Button>
                {!made && (
                  <PaidHint
                    action="app/learn/now/actions.ts#makeTrackOfCard"
                    what="Cost of making a track from this card"
                  />
                )}
              </span>
            )}
            {/* Not interested and the two ratings stay on one line, the
                ratings to its right, down to a 360px phone: that is why the
                labels drop "Too" below sm. */}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onDismiss}
                disabled={testing}
              >
                <X className="size-3.5" strokeWidth={2} aria-hidden />
                Not interested
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => rate('too_hard')}
                aria-label="Too hard"
                aria-pressed={difficulty === 'too_hard'}
                className={cn(
                  'text-danger hover:bg-danger-tint hover:text-danger',
                  difficulty === 'too_hard' && 'bg-danger-tint',
                )}
              >
                {difficulty === 'too_hard' ? (
                  <Check className="size-3.5" strokeWidth={2} aria-hidden />
                ) : (
                  <Weight className="size-3.5" strokeWidth={2} aria-hidden />
                )}
                <span className="sm:hidden">Hard</span>
                <span className="max-sm:hidden">Too hard</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => rate('too_easy')}
                aria-label="Too easy"
                aria-pressed={difficulty === 'too_easy'}
                className={cn(
                  'text-positive hover:bg-positive-tint hover:text-positive',
                  difficulty === 'too_easy' && 'bg-positive-tint',
                )}
              >
                {difficulty === 'too_easy' ? (
                  <Check className="size-3.5" strokeWidth={2} aria-hidden />
                ) : (
                  <Feather className="size-3.5" strokeWidth={2} aria-hidden />
                )}
                <span className="sm:hidden">Easy</span>
                <span className="max-sm:hidden">Too easy</span>
              </Button>
            </div>
          </div>

          {testing && (
            <p className="mt-2 text-small text-ink-muted" aria-live="polite">
              Writing the ideas to test you on. This takes about half a minute, then Practice Flow
              opens on them.
            </p>
          )}
          {making && (
            <p className="mt-2 text-small text-ink-muted" aria-live="polite">
              Writing the track&apos;s units. This takes about half a minute.
            </p>
          )}
          {made && <MadeTrackLine track={made} className="mt-2" />}
          {saved && (
            <p className="mt-2 text-small text-ink-muted">
              On{' '}
              <Link href={`/learn/t/${saved.id}`} className="text-ink underline underline-offset-2">
                {saved.title}
              </Link>
              .
            </p>
          )}
          {error && <p className="mt-2 text-small text-danger">{error}</p>}
        </article>

        {/* The three swipes as buttons, held at the foot of the screen while
            a long card is read, so leaving a card never needs a scroll back. */}
        <div className="sticky bottom-0 grid grid-cols-3 gap-2 rounded-b-[inherit] border-t border-border bg-surface card-pad-x py-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onSwipe('skipped')}
            aria-keyshortcuts="ArrowLeft"
          >
            <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
            Not now
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => onSwipe('known')}
            aria-keyshortcuts="ArrowDown"
          >
            <ArrowDown className="size-3.5" strokeWidth={2} aria-hidden />
            Got it
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onSwipe('review')}
            aria-keyshortcuts="ArrowRight"
          >
            Work on this
            <ArrowRight className="size-3.5" strokeWidth={2} aria-hidden />
          </Button>
        </div>
      </Card>
    </div>
  );
}

/** The line a new track leaves: its name, linked, and where its lessons will come. */
function MadeTrackLine({ track, className }: { track: MadeTrack; className?: string }) {
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
 * the feed deals"; plan #968). Start writes the track with its units and the
 * deck carries on; Not now and Never go through Practice Flow's own action,
 * so a theme set aside here is set aside there too.
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
        error: 'Could not start that track. Check your connection.',
      }));
      if (result.track) onDone(result.track);
      else setError(result.error ?? 'Could not start that track.');
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
        A new track
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
            {starting ? 'Writing the track…' : 'Start'}
          </Button>
          <PaidHint
            action="app/learn/now/actions.ts#startTrackOffer"
            what="Cost of starting the track"
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
          Writing the track&apos;s first ideas and its units. This takes about a minute.
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
        error: 'Could not pick that track up. Check your connection.',
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
        A resting track
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

type Marked = NonNullable<UnitCheckResult['marked']>;

/**
 * The optional check on a unit you have finished (LEARN-LESSONS-SPEC, "The
 * unit check"; plan #971): one question needing the unit's ideas together,
 * answered in a sentence or two. Check my answer has it marked and shows the
 * mark with the answer expected; Skip moves on. Either way the unit stays
 * done, and only a right answer marks its ideas tested.
 */
function UnitCheckCard({
  card,
  onSkip,
  onNext,
}: {
  card: FeedCard;
  onSkip: () => void;
  onNext: () => void;
}) {
  const [response, setResponse] = useState('');
  const [marking, startMarking] = useTransition();
  const [marked, setMarked] = useState<Marked | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = () =>
    startMarking(async () => {
      setError(null);
      const result: UnitCheckResult = await answerUnitCheck(card.id, response).catch(() => ({
        error: 'Could not mark that. Check your connection.',
      }));
      if (result.marked) setMarked(result.marked);
      else setError(result.error ?? 'Could not mark that.');
    });

  return (
    <Card padding="standard">
      <p className="flex items-center gap-1.5 text-small text-ink-muted">
        <GraduationCap className="size-3.5" strokeWidth={2} aria-hidden />
        {card.why}
      </p>
      <h2 className="mt-1 font-display text-title tracking-tight break-words text-ink">{card.title}</h2>
      {card.source && <p className="text-small text-ink-muted">{card.source}</p>}
      {card.context && <p className="mt-2 text-ui text-ink-muted">{card.context}</p>}
      <p className="mt-3 text-body text-ink">{card.question}</p>

      {!marked ? (
        <>
          <Field label="Your answer" id={`check-${card.id}`} hint="A sentence or two, from memory.">
            <Textarea
              id={`check-${card.id}`}
              rows={3}
              maxLength={2000}
              value={response}
              onChange={(event) => setResponse(event.target.value)}
              disabled={marking}
            />
          </Field>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <Button
                type="button"
                variant="primary"
                onClick={check}
                pending={marking}
                disabled={response.trim() === ''}
              >
                {marking ? 'Marking…' : 'Check my answer'}
              </Button>
              <PaidHint action="app/learn/now/actions.ts#answerUnitCheck" what="Cost of marking the answer" />
            </span>
            <Button type="button" variant="secondary" onClick={onSkip} disabled={marking}>
              Skip
            </Button>
          </div>
          {error && <p className="mt-2 text-small text-danger">{error}</p>}
        </>
      ) : (
        <div className="mt-3 space-y-2" aria-live="polite">
          <p className={cn('flex items-center gap-1.5 text-ui font-medium', marked.correct ? 'text-ink' : 'text-ink-muted')}>
            {marked.correct ? (
              <Check className="size-4" strokeWidth={2} aria-hidden />
            ) : (
              <X className="size-4" strokeWidth={2} aria-hidden />
            )}
            {marked.correct ? 'Right.' : 'Not quite.'}
          </p>
          {marked.why && <p className="text-ui text-ink">{marked.why}</p>}
          <p className="text-ui text-ink-muted">Expected: {marked.expected}</p>
          <p className="text-small text-ink-muted">
            {marked.correct
              ? marked.tested === 1
                ? 'One idea in this unit is now marked tested.'
                : `${marked.tested} ideas in this unit are now marked tested.`
              : 'The unit stays done. Its ideas keep the state they had.'}
          </p>
          <Button type="button" variant="primary" onClick={onNext}>
            Next
          </Button>
        </div>
      )}
    </Card>
  );
}
