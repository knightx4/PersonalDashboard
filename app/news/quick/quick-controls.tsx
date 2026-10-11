'use client';

import {
  Fragment,
  createContext,
  startTransition,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useFormStatus } from 'react-dom';
import { ArrowLeft, ArrowRight, ExternalLink, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { BACK_PAGES, parseBack, passKey, pushBack } from '@/lib/news/quick/back';
import { swipeAxis, swipeBackFarEnough, swipeFarEnough } from '@/lib/news/quick/swipe';
import type { Reaction } from '@/lib/news/quick/reactions';
import type { StoryPass } from '@/lib/news/quick/next';
import { useOptimisticWrite } from '@/lib/use-optimistic-write';
import {
  passQuickPage,
  passQuickStory,
  reactToQuickStory,
  recordArticleOpened,
  unpassQuickPage,
} from './actions';
import { SWIPE_RELEASE_MS, follow, release } from '@/components/motion/swipe';

/**
 * The id of the form Next submits. A swipe on the card (#855) submits the
 * same form with `requestSubmit()`, so both go through one action and one
 * pending state.
 */
export const QUICK_NEXT_FORM = 'quick-read-next';

/** The id of the form Back submits on a phone card; a right swipe submits it too (plan #1445). */
const QUICK_BACK_FORM = 'quick-read-back';

/**
 * The one button #847 settled on. It records the story whether or not you
 * read it, with the same event's stories in other newsletters (plan #865),
 * and the page comes back with the next card. `stories` is cardPasses of the
 * card: its own first, then its repeats.
 */
export function QuickNextForm({
  stories,
  ahead = null,
}: {
  stories: readonly StoryPass[];
  /** The story drawn behind this card, which Next slides in and the page then keeps (note a0fc267e). */
  ahead?: StoryPass | null;
}) {
  const raw = useSyncExternalStore(subscribeBack, readBackStoriesRaw, () => null);
  const back = useMemo(() => parseBack(raw), [raw]);
  const previous = back.at(-1);
  const retreat = useContext(RetreatContext);
  return (
    <>
      {/* Previous story (note 460be33e, on a phone): takes back the last
          Next story's pass, so a card skipped too fast comes back. Only once
          there is a card in this tab to go back to. */}
      {previous && (
        <form
          id={QUICK_BACK_FORM}
          onSubmit={() => retreat?.(passKey(previous))}
          action={async (form) => {
            writeBack(BACK_STORIES_KEY, back.slice(0, -1));
            await unpassQuickPage(form);
          }}
        >
          <PassFields stories={previous} />
          <PreviousStoryButton />
        </form>
      )}
      <form
        id={QUICK_NEXT_FORM}
        action={async (form) => {
          writeBack(BACK_STORIES_KEY, pushBack(back, stories));
          await passQuickStory(form);
        }}
      >
        <PassFields stories={stories} />
        {ahead && (
          <>
            <input type="hidden" name="aheadIssueId" value={ahead.issueId} />
            <input type="hidden" name="aheadStoryIndex" value={ahead.storyIndex} />
          </>
        )}
        <NextButton />
      </form>
    </>
  );
}

function PreviousStoryButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="lg"
      variant="secondary"
      pending={pending}
      aria-label="Previous story"
    >
      {!pending && <ArrowLeft className="size-4" strokeWidth={2} aria-hidden />}
      {pending ? 'Loading…' : 'Back'}
    </Button>
  );
}

/** One issueId and storyIndex pair per story, in order, as readPairs in actions.ts reads them. */
function PassFields({ stories }: { stories: readonly StoryPass[] }) {
  return stories.map((story) => (
    <Fragment key={`${story.issueId}:${story.storyIndex}`}>
      <input type="hidden" name="issueId" value={story.issueId} />
      <input type="hidden" name="storyIndex" value={story.storyIndex} />
    </Fragment>
  ));
}

/** What QuickDeck hands the Next button: move to the story already drawn behind this one. */
const AdvanceContext = createContext<(() => void) | null>(null);

/**
 * What QuickDeck hands Back: show the card or page kept under this key, the
 * one Back is taking back, while the undo is recorded (plan #1445).
 */
const RetreatContext = createContext<((key: string) => void) | null>(null);

/**
 * What QuickDeck hands the swipe: the story drawn behind this one, so a drag
 * to the left can bring it in from the right as the current card goes out
 * (note 3164d419), and the card Back would bring back, so a drag to the right
 * brings that in from the left. Null inside either drawing, so the card it
 * draws does not draw its own.
 */
const PeekContext = createContext<{ next: ReactNode; previous: ReactNode } | null>(null);

/** A card or page as QuickDeck draws it: the item, and the Next row held under it. */
type Drawn = { body: ReactNode; row: ReactNode };

/**
 * The cards and pages passed in this tab, kept as they were drawn under
 * their passKey, so Back can show the one it takes back at once rather than
 * wait for the page (plan #1445). Held in memory, so a reload empties it and
 * Back then waits for the page as it used to. Twice BACK_PAGES, as the card
 * and the laptop page each keep their own stack.
 */
const passedCards = new Map<string, Drawn>();

function rememberPassed(key: string, node: Drawn) {
  passedCards.delete(key);
  passedCards.set(key, node);
  while (passedCards.size > BACK_PAGES * 2) {
    const oldest = passedCards.keys().next().value;
    if (oldest === undefined) break;
    passedCards.delete(oldest);
  }
}

function NextButton() {
  const { pending } = useFormStatus();
  const advance = useContext(AdvanceContext);
  // The pass is on its way the moment the form is pending, so the story
  // behind this one can show now rather than when the page comes back.
  useEffect(() => {
    if (pending) advance?.();
  }, [pending, advance]);
  return (
    <Button type="submit" size="lg" pending={pending}>
      {pending ? 'Loading…' : 'Next story'}
      {!pending && <ArrowRight className="size-4" strokeWidth={2} aria-hidden />}
    </Button>
  );
}

/**
 * The phone card with the one after it already drawn (note 452a90d9), and
 * the laptop page with the next page drawn the same way (note 11ec91c5).
 *
 * The page renders both on the server; `next` stays out of the DOM until Next
 * (or a swipe, which submits the same form) goes pending, and then shows at
 * once while the pass is recorded. The page that comes back has that story as
 * its current card, and the caller keys the deck on the current story, so the
 * deck starts again from it with the following story behind it. The next
 * story's picture is fetched ahead as well, so it does not arrive after the
 * words. With no story behind this one, Next waits for the page as before.
 *
 * Back works the same way the other way round (plan #1445). Each card or
 * page Next passes is kept as it was drawn, under its `passes`, and Back
 * shows the kept one the moment it is pressed, while the undo is recorded.
 * `stack` says which Back stack the deck reads, the phone card's or the
 * laptop page's. Next on a card Back brought back returns to the one Back
 * left, which is what the page will come back with.
 *
 * `row` is the phone card's Next row (plan #1636), drawn outside the swipe so
 * it stays where it is while the card under it is dragged away and the next
 * one comes in; `nextRow` is the row of the story behind. The laptop page
 * keeps its Next page inside `current` and passes neither.
 */
export function QuickDeck({
  current,
  next,
  row = null,
  nextRow = null,
  nextImage,
  passes,
  stack,
}: {
  current: ReactNode;
  next: ReactNode | null;
  row?: ReactNode;
  nextRow?: ReactNode;
  nextImage: string | null;
  passes: readonly StoryPass[];
  stack: 'stories' | 'pages';
}) {
  const [advanced, setAdvanced] = useState(false);
  const [retreated, setRetreated] = useState<Drawn | null>(null);
  const raw = useSyncExternalStore(
    subscribeBack,
    stack === 'stories' ? readBackStoriesRaw : readBackPagesRaw,
    () => null,
  );
  const top = useMemo(() => parseBack(raw).at(-1), [raw]);
  const previous = top ? (passedCards.get(passKey(top))?.body ?? null) : null;

  const key = passKey(passes);
  const advance = () => {
    if (retreated) {
      setRetreated(null);
      return;
    }
    rememberPassed(key, { body: current, row });
    if (next) setAdvanced(true);
  };
  const retreat = (backKey: string) => {
    const kept = passedCards.get(backKey);
    if (kept) setRetreated(kept);
  };

  const shown = retreated ? 'retreated' : advanced && next ? 'advanced' : 'current';
  const peek = shown === 'current' ? { next, previous } : null;
  const drawn: Drawn =
    shown === 'retreated' && retreated
      ? retreated
      : shown === 'advanced'
        ? { body: next, row: nextRow }
        : { body: current, row };
  return (
    <AdvanceContext.Provider value={advance}>
      <RetreatContext.Provider value={retreat}>
        <PeekContext.Provider value={peek}>
          <Fragment key={shown}>{drawn.body}</Fragment>
        </PeekContext.Provider>
        {/* Keyed with the card, so a pending Next on the card going out does
            not carry over as Loading on the one coming in. */}
        <Fragment key={`row-${shown}`}>{drawn.row}</Fragment>
      </RetreatContext.Provider>
      {shown === 'current' && nextImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={nextImage} alt="" referrerPolicy="no-referrer" hidden />
      )}
    </AdvanceContext.Provider>
  );
}

/**
 * Next page, the laptop grid's one button (plan #941). #939 settled that it
 * records every story on the page, read or not, and the page comes back with
 * the next set. The stories go as issueId and storyIndex pairs, in order.
 */
export function QuickPageForm({ stories }: { stories: readonly StoryPass[] }) {
  const raw = useSyncExternalStore(subscribeBack, readBackPagesRaw, () => null);
  const back = useMemo(() => parseBack(raw), [raw]);
  const previous = back.at(-1);
  const retreat = useContext(RetreatContext);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Previous page (note 460be33e): takes back the last Next page's
          passes, so a page skipped too fast comes back. Only once there is
          a page in this tab to go back to. */}
      {previous && (
        <form
          onSubmit={() => retreat?.(passKey(previous))}
          action={async (form) => {
            writeBack(BACK_PAGES_KEY, back.slice(0, -1));
            await unpassQuickPage(form);
          }}
        >
          <PassFields stories={previous} />
          <PreviousPageButton />
        </form>
      )}
      <form
        action={async (form) => {
          writeBack(BACK_PAGES_KEY, pushBack(back, stories));
          await passQuickPage(form);
        }}
      >
        <PassFields stories={stories} />
        <NextPageButton />
      </form>
    </div>
  );
}

/**
 * Where the pages Previous page, and the cards Back on a phone, can go back
 * to are kept: this tab, and only this tab. Two stacks, so a window resized
 * across the md break does not take back a page with a card's button.
 */
const BACK_PAGES_KEY = 'news:quick-read:back';
const BACK_STORIES_KEY = 'news:quick-read:back-stories';
const backListeners = new Set<() => void>();

function subscribeBack(listener: () => void) {
  backListeners.add(listener);
  return () => backListeners.delete(listener);
}

function readBackRaw(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

const readBackPagesRaw = () => readBackRaw(BACK_PAGES_KEY);
const readBackStoriesRaw = () => readBackRaw(BACK_STORIES_KEY);

function writeBack(key: string, stack: readonly StoryPass[][]) {
  try {
    sessionStorage.setItem(key, JSON.stringify(stack));
  } catch {
    // Storage refused: Previous page simply has nothing to go back to.
  }
  for (const listener of backListeners) listener();
}

function PreviousPageButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" variant="secondary" pending={pending}>
      {!pending && <ArrowLeft className="size-4" strokeWidth={2} aria-hidden />}
      {pending ? 'Loading…' : 'Previous page'}
    </Button>
  );
}

function NextPageButton() {
  const { pending } = useFormStatus();
  const advance = useContext(AdvanceContext);
  // As NextButton: the page drawn ahead shows the moment the pass is sent
  // (note 11ec91c5).
  useEffect(() => {
    if (pending) advance?.();
  }, [pending, advance]);
  return (
    <Button type="submit" size="lg" pending={pending}>
      {pending ? 'Loading…' : 'Next page'}
      {!pending && <ArrowRight className="size-4" strokeWidth={2} aria-hidden />}
    </Button>
  );
}

/**
 * Thumbs up and thumbs down, where Fewer like this used to be. For now they
 * only record the press (reactToQuickStory): the card stays and nothing is
 * hidden. Pressing the thumb already down takes it back; pressing the other
 * one swaps. Optimistic, as Save is: the thumb fills at once and a refused
 * write puts it back with a toast.
 */
export function ReactionButtons({
  issueId,
  storyIndex,
  reaction,
}: {
  issueId: string;
  storyIndex: number;
  reaction: Reaction | null;
}) {
  const { shown, run, failed } = useOptimisticWrite<Reaction | null, Reaction | null>({
    value: reaction,
    apply: (_current, next) => next,
    write: (next) => reactToQuickStory(issueId, storyIndex, next),
  });
  const press = (thumb: Reaction) => run(shown === thumb ? null : thumb);
  return (
    <div className="flex items-center" role="group" aria-label="How was this story?">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={shown === 'up'}
        aria-label="Thumbs up"
        title={shown === 'up' ? 'Take back your thumbs up' : 'More stories like this'}
        onClick={() => press('up')}
        className={cn(shown === 'up' && 'text-accent', failed && 'text-danger')}
      >
        <ThumbsUp
          className="size-4"
          strokeWidth={1.75}
          fill={shown === 'up' ? 'currentColor' : 'none'}
          aria-hidden
        />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={shown === 'down'}
        aria-label="Thumbs down"
        title={shown === 'down' ? 'Take back your thumbs down' : 'Fewer stories like this'}
        onClick={() => press('down')}
        className={cn(shown === 'down' && 'text-accent', failed && 'text-danger')}
      >
        <ThumbsDown
          className="size-4"
          strokeWidth={1.75}
          fill={shown === 'down' ? 'currentColor' : 'none'}
          aria-hidden
        />
      </Button>
    </div>
  );
}

/**
 * The article, in a new tab. Opening it records the story as passed and
 * opened while the tab opens, and the card stays so you can come back and
 * press Next. The open is what Quick read's ranking learns from.
 */
export function ArticleLink({
  href,
  issueId,
  storyIndex,
}: {
  href: string;
  issueId: string;
  storyIndex: number;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => {
        startTransition(() => {
          void recordArticleOpened(issueId, storyIndex);
        });
      }}
      className="inline-flex items-center gap-1 text-ui text-accent hover:underline"
    >
      Read the article
      <ExternalLink className="size-3" strokeWidth={1.75} aria-hidden />
    </a>
  );
}

/**
 * A left swipe on the card does what Next does (#855), and nothing more:
 * it submits the Next form, so the story is recorded by the same action and
 * the button shows the same pending state. A right swipe does what Back does
 * (plan #1445) the same way, once there is a card to go back to; before
 * that a drag to the right is left to the page.
 *
 * Touch only. A laptop has the button, and a mouse drag across the card is
 * how text gets selected. A drag counts once it is mostly sideways and to the
 * left; anything mostly up or down is left to the page, so a long story
 * scrolls as usual. A touch that starts on a link, a button or the full-story
 * fold keeps its tap, and nothing is sent while a Next is still pending or
 * while text is selected.
 *
 * The card follows the finger exactly (`follow` in components/motion/swipe.ts
 * writes each touch straight onto its style, with no render between), with
 * the story QuickDeck has drawn behind it coming in from the right as it goes
 * (note 3164d419), or the card Back would bring back coming in from the left.
 * Let go short and both spring back to rest; let go far enough and the card
 * springs the rest of the way out (`release`, plan #1551) before the form is
 * sent, so the deck swaps to a story already in place. Under
 * prefers-reduced-motion it stays still and the swipe still works. Keyed on
 * the story by the caller, so a drag never carries over to the next card.
 */
export function QuickSwipe({ children }: { children: ReactNode }) {
  const surface = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  // Which side's card is drawn while a drag or a spring back goes its way:
  // the story behind for a drag left, the one Back brings back for a drag
  // right. Set only when the side changes, so a drag does not re-render.
  const [toward, setToward] = useState<'next' | 'back' | null>(null);
  // Let go far enough: the card is springing the rest of the way out, to the
  // left for Next and to the right for Back, and the form is sent when it
  // has gone.
  const [leaving, setLeaving] = useState<'next' | 'back' | null>(null);
  const peek = useContext(PeekContext);
  // Read by the touch handlers, which are attached once.
  const hasPeek = useRef({ next: false, previous: false });
  useEffect(() => {
    hasPeek.current = { next: Boolean(peek?.next), previous: Boolean(peek?.previous) };
  }, [peek]);

  // Attached by hand rather than through React so the move handler can be
  // non-passive: it cancels the page's own scroll once a drag is a swipe.
  useEffect(() => {
    const element = surface.current;
    const moving = card.current;
    if (!element || !moving) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let start: { x: number; y: number } | null = null;
    let axis: 'swipe' | 'back' | 'page' | null = null;
    let dx = 0;
    let side: 'next' | 'back' | null = null;
    let gone = false;
    let sent = false;

    const show = (next: 'next' | 'back' | null) => {
      if (next === side) return;
      side = next;
      setToward(next);
    };
    // Sends the form once, when the card has finished leaving.
    const send = (direction: 'next' | 'back') => {
      if (sent) return;
      sent = true;
      submitForm(direction === 'back' ? QUICK_BACK_FORM : QUICK_NEXT_FORM);
    };
    const selecting = () => {
      const selection = window.getSelection();
      return !!selection && !selection.isCollapsed;
    };

    const onStart = (event: TouchEvent) => {
      start = null;
      if (gone || event.touches.length !== 1 || selecting()) return;
      const target = event.target as Element | null;
      if (target?.closest('a, button, summary, input, textarea, select, label')) return;
      start = { x: event.touches[0]!.clientX, y: event.touches[0]!.clientY };
      axis = null;
      dx = 0;
    };
    const onMove = (event: TouchEvent) => {
      if (!start) return;
      if (event.touches.length !== 1) {
        start = null;
        void release(moving, '').then(() => show(null));
        return;
      }
      const moveX = event.touches[0]!.clientX - start.x;
      const moveY = event.touches[0]!.clientY - start.y;
      axis ??= swipeAxis(moveX, moveY, Boolean(form(QUICK_BACK_FORM)));
      if (axis !== 'swipe' && axis !== 'back') return;
      event.preventDefault();
      dx = axis === 'swipe' ? Math.min(0, moveX) : Math.max(0, moveX);
      if (still?.matches) return;
      follow(moving, `translateX(${dx}px)`);
      show(dx < 0 ? 'next' : dx > 0 ? 'back' : side);
    };
    const onEnd = () => {
      if (!start) return;
      const claimed = axis;
      start = null;
      axis = null;
      const back = () => void release(moving, '').then(() => show(null));
      if (claimed !== 'swipe' && claimed !== 'back') return;
      if (selecting()) return back();
      const width = element.offsetWidth;
      const direction =
        claimed === 'swipe' && swipeFarEnough(dx, width)
          ? 'next'
          : claimed === 'back' && swipeBackFarEnough(dx, width)
            ? 'back'
            : null;
      if (!direction) return back();
      const id = direction === 'next' ? QUICK_NEXT_FORM : QUICK_BACK_FORM;
      // Either button is disabled while its form is pending, so a second
      // swipe before the page comes back sends nothing.
      if (
        !form(id) ||
        formPending(id) ||
        formPending(QUICK_NEXT_FORM) ||
        formPending(QUICK_BACK_FORM)
      )
        return back();
      // Without motion there is nothing to watch go, and with no card drawn
      // on that side there is nothing to bring in: send at once, and the
      // card springs back to wait for the page as it did before.
      const drawn = direction === 'next' ? hasPeek.current.next : hasPeek.current.previous;
      if (still?.matches || !drawn) {
        submitForm(id);
        return back();
      }
      gone = true;
      setLeaving(direction);
      void release(
        moving,
        direction === 'next'
          ? `translateX(calc(-100% - ${PEEK_GAP}))`
          : `translateX(calc(100% + ${PEEK_GAP}))`,
      ).then(() => send(direction));
      // A spring that never finishes (the tab hidden mid-slide) still sends.
      window.setTimeout(() => send(direction), SWIPE_RELEASE_MS + 100);
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

  // The story behind this one rides a card's width and a gap to the right,
  // in the same track, so it comes in exactly as far as this one goes out;
  // the card Back would bring back rides the same distance to the left.
  // Each is only drawn while a drag, a spring back or the way out goes its
  // way.
  const showNext = Boolean(peek?.next) && (leaving ?? toward) === 'next';
  const showPrevious = Boolean(peek?.previous) && (leaving ?? toward) === 'back';

  return (
    // Clip rather than hidden, so the card is not made a scroll container;
    // it keeps the story coming in from widening the page.
    // `data-quick-swipe` is what the gallery's recorder drags (npm run record).
    <div
      ref={surface}
      data-quick-swipe
      className={cn((showNext || showPrevious) && 'overflow-clip')}
    >
      {/* Its transform is written by follow and release, never by React. */}
      <div ref={card} className="relative">
        {children}
        {(showNext || showPrevious) && (
          <PeekContext.Provider value={null}>
            <div
              inert
              aria-hidden
              className="absolute top-0 w-full"
              style={
                showNext
                  ? { left: `calc(100% + ${PEEK_GAP})` }
                  : { right: `calc(100% + ${PEEK_GAP})` }
              }
            >
              {showNext ? peek?.next : peek?.previous}
            </div>
          </PeekContext.Provider>
        )}
      </div>
    </div>
  );
}

/** The space between the card going out and the one coming in. */
const PEEK_GAP = '1rem';

/**
 * The Next or Back form, in the row QuickDeck holds under the card. The card
 * coming in during a drag has no row of its own (plan #1636), so there is
 * only ever one of each.
 */
function form(id: string): HTMLFormElement | null {
  const element = document.getElementById(id);
  return element instanceof HTMLFormElement ? element : null;
}

function formPending(id: string): boolean {
  return Boolean(form(id)?.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled);
}

function submitForm(id: string) {
  const element = form(id);
  if (element && !formPending(id)) element.requestSubmit();
}
