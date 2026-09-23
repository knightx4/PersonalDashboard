'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { ArrowDown, Bookmark, Check, ExternalLink, GraduationCap, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { appendCards, feedEnd, FEED_PAGE, type FeedCard } from '@/lib/learn/feed/card';
import { createPassTracker } from '@/lib/learn/feed/scroll';
import { dismissCard, loadMoreCards, openCardSource, passCard, saveCard, testMeOnCard } from './actions';

/**
 * The Learn now feed (plan #808, LEARN-NOW-SPEC "A card").
 *
 * One card after another. The next few are loaded as the last one comes into
 * view, leaving out the ones already on the screen, so a card is not shown
 * twice in one visit. Pressing Next marks the card passed (plan #833), and so
 * does scrolling on until a card that was on the screen has gone out of view
 * above (plan #835). A passed card is not shown on a later visit. A card that
 * never reached the screen, or that you scrolled back up away from, comes back
 * next time. Passing is never read as dislike.
 *
 * A card per item, which law 13 otherwise forbids for a list. This is not a
 * list to scan: each card is read on its own, one to a screen on a phone, and
 * the card's edge is where one reading stops and the next starts.
 */
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
  const [cards, setCards] = useState(first);
  const [ready, setReady] = useState(firstReady);
  const [ended, setEnded] = useState(first.length < FEED_PAGE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = useRef(first.map((card) => card.id));
  const busy = useRef(false);
  const foot = useRef<HTMLDivElement>(null);
  // One per visit, shared by Next and the scroll observer, so a card is
  // passed at most once and Next with the scroll it causes is one write.
  const [passes] = useState(() => createPassTracker((id) => void passCard(id).catch(() => undefined)));

  const loadMore = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const more = await loadMoreCards(shown.current);
      shown.current = [...shown.current, ...more.cards.map((card) => card.id)];
      setCards((current) => appendCards(current, more.cards));
      setReady(more.ready);
      setEnded(more.cards.length < FEED_PAGE);
    } catch {
      setError('Could not load more cards. Try again in a moment.');
      setEnded(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  // The next page is asked for while the last card is still a screen away,
  // so scrolling does not stop to wait for it.
  useEffect(() => {
    const target = foot.current;
    if (!target || ended || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: '0px 0px 800px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [ended, loadMore, cards.length]);

  // A card counts as passed once it has been on the screen and then leaves
  // through the top. The observer is rebuilt as cards are added; the tracker
  // keeps what each card has done, so rebuilding it marks nothing twice.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.cardId;
        if (!id) continue;
        passes.sighted(id, {
          isIntersecting: entry.isIntersecting,
          bottom: entry.boundingClientRect.bottom,
          rootTop: entry.rootBounds?.top ?? 0,
        });
      }
    });
    for (const card of cards) {
      const element = document.getElementById(`card-${card.id}`);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [cards, passes]);

  const next = (index: number) => {
    const following = cards[index + 1];
    const element = following ? document.getElementById(`card-${following.id}`) : foot.current;
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const end = feedEnd(ready, low);

  return (
    <div className="space-y-4">
      {cards.map((card, index) => (
        <FeedCardView
          key={card.id}
          card={card}
          onNext={() => next(index)}
          onPass={() => passes.next(card.id)}
          onSettle={() => passes.settle(card.id)}
        />
      ))}

      <div ref={foot} className="scroll-mt-4 py-4 text-center">
        {loading ? (
          <p className="text-ui text-ink-muted" aria-live="polite">
            Loading more cards…
          </p>
        ) : ended ? (
          <div className="space-y-3">
            <p className="text-ui text-ink-muted">
              {error ??
                (end === 'writing'
                  ? cards.length === 0
                    ? 'No cards are ready yet. More are being written from what you write about, a few minutes each.'
                    : 'More are being written. They take a few minutes each.'
                  : 'That is every card ready now. Any you have not scrolled past or pressed Next on come back on your next visit.')}
            </p>
            <Button type="button" variant="secondary" onClick={() => void loadMore()}>
              Check again
            </Button>
          </div>
        ) : (
          <Button type="button" variant="secondary" onClick={() => void loadMore()}>
            More
          </Button>
        )}
      </div>
    </div>
  );
}

type Outcome = { kind: 'saved'; list: { id: string; title: string } } | { kind: 'dismissed' } | null;

function FeedCardView({
  card,
  onNext,
  onPass,
  onSettle,
}: {
  card: FeedCard;
  /** Scroll on to the next card. */
  onNext: () => void;
  /** Mark this card passed, unless it already is. */
  onPass: () => void;
  /** Saved or turned down, so scrolling past it no longer marks it. */
  onSettle: () => void;
}) {
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();

  const save = () =>
    startSave(async () => {
      setError(null);
      const result = await saveCard(card.id);
      if (result.list) {
        onSettle();
        setOutcome({ kind: 'saved', list: result.list });
      }
      else setError(result.error ?? 'Could not save that.');
    });

  // Optimistic: the card folds at once, and comes back with the reason if the
  // write failed.
  const dismiss = () => {
    setError(null);
    onSettle();
    setOutcome({ kind: 'dismissed' });
    onNext();
    void dismissCard(card.id).then((result) => {
      if (result.error) {
        setOutcome(null);
        setError(result.error);
      }
    });
  };

  // Next records the pass and scrolls on. Not interested also scrolls on,
  // through onNext, and settles the card first so the scroll does not record
  // a pass: its own write is the one that counts.
  const pass = () => {
    onPass();
    onNext();
  };

  const testMe = () =>
    startTest(async () => {
      setError(null);
      // Redirects to Practice Flow on success, so only a failure comes back.
      const result = await testMeOnCard(card.id);
      if (result?.error) setError(result.error);
    });

  if (outcome?.kind === 'dismissed') {
    return (
      <Card id={`card-${card.id}`} data-card-id={card.id} padding="dense" className="scroll-mt-4">
        <p className="text-ui text-ink-muted">
          Not interested in {card.title}. It will not come back.
        </p>
      </Card>
    );
  }

  return (
    <Card id={`card-${card.id}`} data-card-id={card.id} padding="standard" className="scroll-mt-4">
      <article className="min-w-0">
        <p className="text-small text-ink-muted">{card.why}</p>
        <h2 className="mt-1 font-display text-title tracking-tight break-words text-ink">{card.title}</h2>

        <p className="mt-3 text-body font-medium text-ink">{card.summary}</p>

        <div className="mt-4 space-y-3 text-body break-words text-ink">
          {card.shown.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>

        {card.rest.length > 0 && (
          // Native, so it opens before JavaScript loads. The summary goes once
          // the rest is open: the text simply carries on.
          <details className="group mt-3">
            <summary className="press inline-flex cursor-pointer list-none items-center gap-1.5 rounded-control text-ui font-medium text-accent group-open:hidden [&::-webkit-details-marker]:hidden">
              Read the rest
              <span className="font-normal text-ink-muted">{card.restMinutes} min</span>
            </summary>
            <div className="space-y-3 text-body break-words text-ink">
              {card.rest.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          </details>
        )}

        <p className="mt-4 text-small text-ink-muted">
          <a
            href={card.link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => void openCardSource(card.id)}
            className="inline-flex items-center gap-1 text-ink underline underline-offset-2 hover:text-accent"
          >
            {card.title}
            <ExternalLink className="size-3" strokeWidth={2} aria-hidden />
          </a>
          {` · ${card.site}`}
          {card.licence ? ` · ${card.licence}` : ''}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="button" variant="primary" onClick={pass}>
            <ArrowDown className="size-3.5" strokeWidth={2} aria-hidden />
            Next
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={save}
            pending={saving}
            disabled={outcome?.kind === 'saved'}
          >
            {outcome?.kind === 'saved' ? (
              <Check className="size-3.5" strokeWidth={2} aria-hidden />
            ) : (
              <Bookmark className="size-3.5" strokeWidth={2} aria-hidden />
            )}
            {outcome?.kind === 'saved' ? 'Saved' : saving ? 'Saving…' : 'Save'}
          </Button>
          <Button type="button" variant="secondary" onClick={testMe} pending={testing}>
            <GraduationCap className="size-3.5" strokeWidth={2} aria-hidden />
            {testing ? 'Starting a track…' : 'Test me on this'}
          </Button>
          <Button type="button" variant="ghost" onClick={dismiss} disabled={testing}>
            <X className="size-3.5" strokeWidth={2} aria-hidden />
            Not interested
          </Button>
        </div>

        {testing && (
          <p className="mt-2 text-small text-ink-muted" aria-live="polite">
            Writing the ideas to test you on. This takes about half a minute, then Practice Flow opens on them.
          </p>
        )}
        {outcome?.kind === 'saved' && (
          <p className="mt-2 text-small text-ink-muted">
            On{' '}
            <Link href={`/learn/t/${outcome.list.id}`} className="text-ink underline underline-offset-2">
              {outcome.list.title}
            </Link>
            .
          </p>
        )}
        {error && <p className="mt-2 text-small text-danger">{error}</p>}
      </article>
    </Card>
  );
}
