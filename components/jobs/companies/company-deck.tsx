'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tooltip } from '@/components/ui/tooltip';
import { follow, release, SWIPE_RELEASE_MS } from '@/components/motion/swipe';
import { prefersReducedMotion } from '@/components/motion/reduced';
import { swipeAxis, swipeBackFarEnough, swipeFarEnough } from '@/lib/news/quick/swipe';
import { cn } from '@/lib/cn';

/**
 * The Companies page's focused view as a deck (plan #2341.4): one company at
 * a time, stepped through in the order the table is sorted and within what
 * it is filtered to.
 *
 * It holds to the deck pattern (components/patterns/deck.tsx) with two
 * differences that pattern's Deck cannot give it. It opens part way through,
 * on the company a table row named, and it walks the list both ways to its
 * ends, Previous and Next going grey there, rather than passing items and
 * keeping five to take back. Every company is drawn on the server and handed
 * in, so a step shows the next one at once, and the address follows with
 * `replaceState`, so a reload opens the same company without a step costing a
 * round trip.
 *
 * Arrow keys step too, and a swipe drags the company with the finger and
 * brings its neighbour in beside it.
 */

export type DeckCompany = {
  /** The slug, stable across renders. */
  key: string;
  /** The page's address with this company focused, written on each step. */
  href: string;
  /** The company as it is drawn. */
  body: ReactNode;
  /** Its mark, fetched while a neighbour is on screen so a step shows it at once. */
  image?: string | null;
  /** The company's other actions, at the start of the forward row. */
  actions?: ReactNode;
};

/** The space between the company going out and the one coming in. */
const PEEK_GAP = '1rem';

/** Whether a key press is someone typing, which the arrows must leave alone. */
function typing(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return (
    element.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) ||
    Boolean(element.closest('[role="menu"], [role="dialog"], [role="listbox"]'))
  );
}

export function CompanyDeck({
  companies,
  start,
}: {
  companies: readonly DeckCompany[];
  /** Where it opens: the company the address names. */
  start: number;
}) {
  const [index, setIndex] = useState(start);
  const at = Math.min(Math.max(index, 0), companies.length - 1);
  const current = companies[at]!;
  const previous = companies[at - 1] ?? null;
  const next = companies[at + 1] ?? null;

  const go = (to: number) => {
    const target = companies[to];
    if (!target) return;
    setIndex(to);
    window.history.replaceState(window.history.state, '', target.href);
  };
  // Read by the key and touch handlers, which are attached once.
  const goRef = useRef(go);
  const atRef = useRef(at);
  useEffect(() => {
    goRef.current = go;
    atRef.current = at;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (typing(event.target)) return;
      if (event.key === 'ArrowRight') goRef.current(atRef.current + 1);
      else if (event.key === 'ArrowLeft') goRef.current(atRef.current - 1);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div>
      <CompanySwipe
        key={current.key}
        previous={previous}
        next={next}
        onNext={() => goRef.current(atRef.current + 1)}
        onPrevious={() => goRef.current(atRef.current - 1)}
      >
        <div data-deck-item>{current.body}</div>
      </CompanySwipe>
      <Card
        padding="none"
        className="sticky bottom-[calc(var(--dock-h)+env(safe-area-inset-bottom))] z-over-link mt-3 flex items-center gap-2 px-3 py-2 lg:static"
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{current.actions}</div>
        <span className="tabular shrink-0 text-small text-ink-muted" aria-live="polite">
          {at + 1} of {companies.length}
        </span>
        <Tooltip label="Previous company (left arrow)" above>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => go(at - 1)}
            disabled={!previous}
            aria-label="Previous"
            className="active:bg-sunken"
            data-deck-previous
          >
            <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden />
            <span className="max-sm:sr-only">Previous</span>
          </Button>
        </Tooltip>
        {/* At the last company Next goes quiet as well as grey, so the one
            working control there, Previous, is not outweighed. */}
        <Button
          size="lg"
          variant={next ? 'primary' : 'secondary'}
          onClick={() => go(at + 1)}
          disabled={!next}
          data-deck-next
        >
          Next
          <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
        </Button>
      </Card>
      {/* The row is held above the tab bar; this gives it somewhere to come
          to rest at the end, so it never covers the company's last lines. */}
      <div aria-hidden className="h-[calc(var(--dock-h)+env(safe-area-inset-bottom))] lg:hidden" />
      {[next, previous].map(
        (company) =>
          company?.image && (
            // The neighbours' marks, fetched now so they do not arrive after the words.
            // eslint-disable-next-line @next/next/no-img-element
            <img key={company.key} src={company.image} alt="" referrerPolicy="no-referrer" hidden />
          ),
      )}
    </div>
  );
}

/**
 * The company under the finger, with the one it would step to riding a
 * card's width beside it while a drag goes that way. Keyed on the company,
 * so a drag never carries over. The transform is written by `follow` and
 * `release` (components/motion/swipe.ts), never by React.
 */
function CompanySwipe({
  previous,
  next,
  onNext,
  onPrevious,
  children,
}: {
  previous: DeckCompany | null;
  next: DeckCompany | null;
  onNext: () => void;
  onPrevious: () => void;
  children: ReactNode;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [peeking, setPeeking] = useState<'next' | 'previous' | null>(null);
  const ends = useRef({ previous: false, next: false });
  const moves = useRef({ onNext, onPrevious });
  useEffect(() => {
    ends.current = { previous: Boolean(previous), next: Boolean(next) };
    moves.current = { onNext, onPrevious };
  });

  useEffect(() => {
    const element = surface.current;
    const moving = card.current;
    if (!element || !moving) return;
    let start: { x: number; y: number } | null = null;
    let axis: ReturnType<typeof swipeAxis> = null;
    let dx = 0;
    let gone = false;

    const onStart = (event: TouchEvent) => {
      start = null;
      if (gone || event.touches.length !== 1) return;
      const target = event.target as Element | null;
      if (target?.closest('a, button, summary, input, textarea, select, label')) return;
      start = { x: event.touches[0]!.clientX, y: event.touches[0]!.clientY };
      axis = null;
      dx = 0;
    };
    const onMove = (event: TouchEvent) => {
      if (!start || event.touches.length !== 1) return;
      const moveX = event.touches[0]!.clientX - start.x;
      const moveY = event.touches[0]!.clientY - start.y;
      axis ??= swipeAxis(moveX, moveY, ends.current.previous);
      // Toward an end there is nothing to bring in, so the page keeps the touch.
      if (axis === 'swipe' && !ends.current.next) axis = 'page';
      if (axis !== 'swipe' && axis !== 'back') return;
      event.preventDefault();
      dx = axis === 'swipe' ? Math.min(0, moveX) : Math.max(0, moveX);
      if (prefersReducedMotion()) return;
      follow(moving, `translateX(${dx}px)`);
      setPeeking(axis === 'swipe' ? 'next' : 'previous');
    };
    const onEnd = () => {
      if (!start) return;
      const claimed = axis;
      start = null;
      axis = null;
      if (claimed !== 'swipe' && claimed !== 'back') return;
      const far =
        claimed === 'swipe'
          ? swipeFarEnough(dx, element.offsetWidth)
          : swipeBackFarEnough(dx, element.offsetWidth);
      if (!far) {
        void release(moving, '').then(() => setPeeking(null));
        return;
      }
      gone = true;
      const step = claimed === 'swipe' ? moves.current.onNext : moves.current.onPrevious;
      if (prefersReducedMotion()) {
        step();
        return;
      }
      let sent = false;
      const send = () => {
        if (sent) return;
        sent = true;
        step();
      };
      const away = claimed === 'swipe' ? `calc(-100% - ${PEEK_GAP})` : `calc(100% + ${PEEK_GAP})`;
      void release(moving, `translateX(${away})`).then(send);
      // A spring that never finishes (the tab hidden mid-slide) still moves on.
      window.setTimeout(send, SWIPE_RELEASE_MS + 100);
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

  const beside = peeking === 'next' ? next : peeking === 'previous' ? previous : null;

  return (
    // Clip rather than hidden while a neighbour is drawn beside this one, so
    // it never widens the page.
    <div ref={surface} data-deck-swipe className={cn(peeking && 'overflow-clip')}>
      <div ref={card} className="relative">
        {children}
        {beside && (
          <div
            inert
            aria-hidden
            className="absolute top-0 w-full"
            style={
              peeking === 'next'
                ? { left: `calc(100% + ${PEEK_GAP})` }
                : { right: `calc(100% + ${PEEK_GAP})` }
            }
          >
            {beside.body}
          </div>
        )}
      </div>
    </div>
  );
}
