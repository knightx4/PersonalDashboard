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
  GraduationCap,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import {
  appendCards,
  feedEnd,
  PRELOAD_AHEAD,
  type FeedCard,
  type SwipeAction,
} from '@/lib/learn/feed/card';
import {
  dismissCard,
  loadMoreCards,
  openCardSource,
  saveCard,
  swipeCard,
  testMeOnCard,
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

export function LearnNowFeed({
  first,
  ready: firstReady,
  low,
}: {
  first: FeedCard[];
  ready: number;
  /** Below this many ready cards, loading more starts a top-up. */
  low: number;
}) {
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
      if (!swipeAs || !current) return;
      event.preventDefault();
      swipe(swipeAs);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, swipe]);

  const end = feedEnd(ready, low);
  const ahead = Math.max(0, deck.length - 1);

  return (
    <div ref={top} className="scroll-mt-4">
      {error && (
        <p className="mb-2 text-small text-danger" role="alert">
          {error}
        </p>
      )}

      {current ? (
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
          <DeckCard
            key={current.id}
            card={current}
            leaving={leaving?.id === current.id ? leaving.swipe : null}
            onSwipe={swipe}
            onDismiss={dismiss}
          />
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
            'pointer-events-none absolute inset-x-0 top-3 z-10 mx-auto w-fit rounded-pill px-3 py-1 text-ui font-semibold',
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

          {card.hook && <p className="mt-3 text-body font-semibold text-ink">{card.hook}</p>}
          <p className="mt-2 text-body text-ink">{card.summary}</p>

          {card.example && (
            <section className="mt-4 rounded-control bg-accent-tint px-3 py-2.5">
              <h3 className="text-small font-semibold text-accent">In practice</h3>
              <p className="mt-1 text-body text-ink">{card.example}</p>
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
              first, and this is there for when you want the whole section. */}
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

          <div className="mt-3 flex flex-wrap items-center gap-2">
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
            <Button type="button" variant="ghost" size="sm" onClick={testMe} pending={testing}>
              <GraduationCap className="size-3.5" strokeWidth={2} aria-hidden />
              {testing ? 'Starting a track…' : 'Test me on this'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onDismiss} disabled={testing}>
              <X className="size-3.5" strokeWidth={2} aria-hidden />
              Not interested
            </Button>
          </div>

          {testing && (
            <p className="mt-2 text-small text-ink-muted" aria-live="polite">
              Writing the ideas to test you on. This takes about half a minute, then Practice Flow
              opens on them.
            </p>
          )}
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
