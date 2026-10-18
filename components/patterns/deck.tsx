'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { follow, release, SWIPE_RELEASE_MS } from '@/components/motion/swipe';
import { prefersReducedMotion } from '@/components/motion/reduced';
import { swipeAxis, swipeFarEnough } from '@/lib/news/quick/swipe';
import { cn } from '@/lib/cn';

/**
 * The deck pattern (docs/UI-QUALITY-SPEC.md, Part 4): one item at a time,
 * with a fixed forward action and the next item already loaded. Quick read
 * (app/news/quick/) is the reference; this is its shape without its stories.
 *
 * What it holds to, each one a preference in app/dev/ui/taste.ts:
 *
 * - The forward action sits in the same place on every item, held just above
 *   the tab bar on a phone, so it never needs a scroll to reach
 *   (`forward-action-in-reach`). From lg there is no tab bar and the row sits
 *   at the foot of the item.
 * - The next item is drawn before it is asked for, picture included, so the
 *   forward press shows it at once (`next-item-preloaded`). The press is
 *   reported through `onForward` and not waited on.
 * - A swipe to the left drags the item with the finger and brings the next
 *   one in from the right as it goes (`swipe-shows-next`). Under reduced
 *   motion it stays still and the swipe still moves on.
 *
 * The rule is on /dev/ui under "Page patterns" (app/dev/ui/patterns.tsx), and
 * the gallery's `pattern-deck` declares itself a deck to the phone checks
 * with `[data-deck-next]` and `[data-deck-item]` (lib/preview/deck.ts).
 */

export type DeckItem = {
  /** Stable across renders: what the forward press reports. */
  key: string;
  /** The item as it is drawn: usually a Card. */
  body: ReactNode;
  /** A picture the item shows, fetched while the item before it is on screen. */
  image?: string | null;
  /** The item's other actions, at the start of the forward row. Keep to two or three. */
  actions?: ReactNode;
};

/** The space between the item going out and the one coming in. */
const PEEK_GAP = '1rem';

/** How many items Previous can take back, as many as Quick read keeps. */
export const DECK_BACK_LIMIT = 5;

export function Deck({
  items,
  forward = 'Next',
  onForward,
  onPrevious,
  alreadyPassed = [],
  countOnPhone = true,
  done,
  className,
}: {
  /** The items in the order they are worked through. */
  items: readonly DeckItem[];
  /** What the forward button says. */
  forward?: string;
  /** Told when an item is passed, by the button or a swipe. The deck does not wait for it. */
  onForward?: (key: string) => void;
  /**
   * Told when Previous brings an item back. The deck keeps the last few items
   * it passed and draws Previous beside the forward button once there is one.
   * The item is drawn again from `items`, so a caller passes this only to take
   * back what passing it recorded.
   */
  onPrevious?: (key: string) => void;
  /** Keys of items to start with as already passed; the gallery draws Previous with it. */
  alreadyPassed?: readonly string[];
  /**
   * False leaves the "1 of 3" count to screen readers on a phone, for items
   * whose actions need its room to share one line with the forward press
   * (Right, Not quite and Wrong on the Insights tab). From sm it shows.
   */
  countOnPhone?: boolean;
  /** What shows once every item has been passed. */
  done: ReactNode;
  className?: string;
}) {
  // Keys, oldest first: what has been passed, and what Previous has brought
  // back and the forward press has not passed again (the last is on screen).
  // Keys and not positions, since an item can leave `items` while it is on
  // screen, as a filed note does.
  const [passed, setPassed] = useState<readonly string[]>(alreadyPassed);
  const [returned, setReturned] = useState<readonly string[]>([]);
  const byKey = new Map(items.map((item) => [item.key, item]));
  const behind = passed.filter((key) => byKey.has(key));
  const back = returned.filter((key) => byKey.has(key));
  const fresh = items.filter((item) => !passed.includes(item.key) && !returned.includes(item.key));
  const current = (back.length > 0 ? byKey.get(back[back.length - 1]!) : fresh[0]) ?? null;
  const next =
    (back.length > 1
      ? byKey.get(back[back.length - 2]!)
      : back.length === 1
        ? fresh[0]
        : fresh[1]) ?? null;
  const previousKey = back.length < DECK_BACK_LIMIT ? behind[behind.length - 1] : undefined;

  const advance = () => {
    if (!current) return;
    onForward?.(current.key);
    setPassed((keys) => [...keys, current.key]);
    setReturned((keys) => keys.filter((key) => key !== current.key));
  };
  const previous = () => {
    if (!previousKey) return;
    onPrevious?.(previousKey);
    setPassed((keys) => keys.filter((key) => key !== previousKey));
    setReturned((keys) => [...keys, previousKey]);
  };
  // Read by the touch handlers, which are attached once per item.
  const advanceRef = useRef(advance);
  useEffect(() => {
    advanceRef.current = advance;
  });

  if (!current) return <div className={className}>{done}</div>;

  return (
    <div className={className}>
      <DeckSwipe key={current.key} next={next} onSwiped={() => advanceRef.current()}>
        <div data-deck-item>{current.body}</div>
      </DeckSwipe>
      <Card
        padding="none"
        className="sticky bottom-[calc(var(--dock-h)+env(safe-area-inset-bottom))] z-over-link mt-3 flex items-center gap-2 px-3 py-2 lg:static"
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {current.actions}
        </div>
        <span className={cn('tabular shrink-0 text-small text-ink-muted', !countOnPhone && 'max-sm:sr-only')}>
          {behind.length + 1} of {items.length}
        </span>
        {previousKey && (
          <Button
            size="lg"
            variant="secondary"
            onClick={previous}
            aria-label="Previous"
            className="active:bg-sunken"
            data-deck-previous
          >
            <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden />
            <span className="max-sm:sr-only">Previous</span>
          </Button>
        )}
        <Button size="lg" onClick={advance} data-deck-next>
          {forward}
          <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
        </Button>
      </Card>
      {next?.image && (
        // The next picture, fetched now so it does not arrive after the words.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={next.image} alt="" referrerPolicy="no-referrer" hidden />
      )}
    </div>
  );
}

/**
 * The current item under the finger, with the next one riding a card's width
 * to its right while a drag goes that way. Keyed on the item by the deck, so
 * a drag never carries over. The transform is written by `follow` and
 * `release` (components/motion/swipe.ts), never by React.
 */
function DeckSwipe({
  next,
  onSwiped,
  children,
}: {
  next: DeckItem | null;
  onSwiped: () => void;
  children: ReactNode;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [peeking, setPeeking] = useState(false);
  const hasNext = useRef(false);
  const swiped = useRef(onSwiped);
  useEffect(() => {
    hasNext.current = Boolean(next);
    swiped.current = onSwiped;
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
      axis ??= swipeAxis(moveX, moveY);
      if (axis !== 'swipe') return;
      event.preventDefault();
      dx = Math.min(0, moveX);
      if (prefersReducedMotion()) return;
      follow(moving, `translateX(${dx}px)`);
      setPeeking(true);
    };
    const onEnd = () => {
      if (!start) return;
      const claimed = axis;
      start = null;
      axis = null;
      if (claimed !== 'swipe') return;
      if (!swipeFarEnough(dx, element.offsetWidth)) {
        void release(moving, '').then(() => setPeeking(false));
        return;
      }
      gone = true;
      if (prefersReducedMotion() || !hasNext.current) {
        swiped.current();
        return;
      }
      let sent = false;
      const send = () => {
        if (sent) return;
        sent = true;
        swiped.current();
      };
      void release(moving, `translateX(calc(-100% - ${PEEK_GAP}))`).then(send);
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

  return (
    // Clip rather than hidden while the next item is drawn beside this one,
    // so it never widens the page.
    <div ref={surface} data-deck-swipe className={cn(peeking && 'overflow-clip')}>
      <div ref={card} className="relative">
        {children}
        {peeking && next && (
          <div
            inert
            aria-hidden
            className="absolute top-0 w-full"
            style={{ left: `calc(100% + ${PEEK_GAP})` }}
          >
            {next.body}
          </div>
        )}
      </div>
    </div>
  );
}
