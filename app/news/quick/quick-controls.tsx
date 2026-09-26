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
import { parseBack, pushBack } from '@/lib/news/quick/back';
import { swipeAxis, swipeFarEnough } from '@/lib/news/quick/swipe';
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

/**
 * The id of the form Next submits. A swipe on the card (#855) submits the
 * same form with `requestSubmit()`, so both go through one action and one
 * pending state.
 */
export const QUICK_NEXT_FORM = 'quick-read-next';

/**
 * The one button #847 settled on. It records the story whether or not you
 * read it, with the same event's stories in other newsletters (plan #865),
 * and the page comes back with the next card. `stories` is cardPasses of the
 * card: its own first, then its repeats.
 */
export function QuickNextForm({ stories }: { stories: readonly StoryPass[] }) {
  return (
    <form id={QUICK_NEXT_FORM} action={passQuickStory}>
      <PassFields stories={stories} />
      <NextButton />
    </form>
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
 * The phone card with the one after it already drawn (note 452a90d9).
 *
 * The page renders both on the server; `next` stays out of the DOM until Next
 * (or a swipe, which submits the same form) goes pending, and then shows at
 * once while the pass is recorded. The page that comes back has that story as
 * its current card, and the caller keys the deck on the current story, so the
 * deck starts again from it with the following story behind it. The next
 * story's picture is fetched ahead as well, so it does not arrive after the
 * words. With no story behind this one, Next waits for the page as before.
 */
export function QuickDeck({
  current,
  next,
  nextImage,
}: {
  current: ReactNode;
  next: ReactNode | null;
  nextImage: string | null;
}) {
  const [advanced, setAdvanced] = useState(false);
  const advance = next ? () => setAdvanced(true) : null;
  return (
    <AdvanceContext.Provider value={advance}>
      {advanced && next ? next : current}
      {!advanced && nextImage && (
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
  const raw = useSyncExternalStore(subscribeBack, readBackRaw, () => null);
  const back = useMemo(() => parseBack(raw), [raw]);
  const previous = back.at(-1);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Previous page (note 460be33e): takes back the last Next page's
          passes, so a page skipped too fast comes back. Only once there is
          a page in this tab to go back to. */}
      {previous && (
        <form
          action={async (form) => {
            writeBack(back.slice(0, -1));
            await unpassQuickPage(form);
          }}
        >
          <PassFields stories={previous} />
          <PreviousPageButton />
        </form>
      )}
      <form
        action={async (form) => {
          writeBack(pushBack(back, stories));
          await passQuickPage(form);
        }}
      >
        <PassFields stories={stories} />
        <NextPageButton />
      </form>
    </div>
  );
}

/** Where the pages Previous page can go back to are kept: this tab, and only this tab. */
const BACK_KEY = 'news:quick-read:back';
const backListeners = new Set<() => void>();

function subscribeBack(listener: () => void) {
  backListeners.add(listener);
  return () => backListeners.delete(listener);
}

function readBackRaw(): string | null {
  try {
    return sessionStorage.getItem(BACK_KEY);
  } catch {
    return null;
  }
}

function writeBack(stack: readonly StoryPass[][]) {
  try {
    sessionStorage.setItem(BACK_KEY, JSON.stringify(stack));
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
 * the button shows the same pending state.
 *
 * Touch only. A laptop has the button, and a mouse drag across the card is
 * how text gets selected. A drag counts once it is mostly sideways and to the
 * left; anything mostly up or down is left to the page, so a long story
 * scrolls as usual. A touch that starts on a link, a button or the full-story
 * fold keeps its tap, and nothing is sent while a Next is still pending or
 * while text is selected.
 *
 * The card follows the finger and springs back when let go. Under
 * prefers-reduced-motion it stays still and the swipe still works. Keyed on
 * the story by the caller, so a drag never carries over to the next card.
 */
export function QuickSwipe({ children }: { children: ReactNode }) {
  const surface = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState<number | null>(null);

  // Attached by hand rather than through React so the move handler can be
  // non-passive: it cancels the page's own scroll once a drag is a swipe.
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let start: { x: number; y: number } | null = null;
    let axis: 'swipe' | 'page' | null = null;
    let dx = 0;

    const selecting = () => {
      const selection = window.getSelection();
      return !!selection && !selection.isCollapsed;
    };

    const onStart = (event: TouchEvent) => {
      start = null;
      if (event.touches.length !== 1 || selecting()) return;
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
        setOffset(null);
        return;
      }
      const moveX = event.touches[0]!.clientX - start.x;
      const moveY = event.touches[0]!.clientY - start.y;
      axis ??= swipeAxis(moveX, moveY);
      if (axis !== 'swipe') return;
      event.preventDefault();
      dx = Math.min(0, moveX);
      if (!still?.matches) setOffset(dx);
    };
    const onEnd = () => {
      if (!start) return;
      const claimed = axis === 'swipe';
      start = null;
      axis = null;
      setOffset(null);
      if (!claimed || !swipeFarEnough(dx, element.offsetWidth) || selecting()) return;
      const form = document.getElementById(QUICK_NEXT_FORM);
      if (!(form instanceof HTMLFormElement)) return;
      // The button is disabled while Next is pending, so a second swipe
      // before the next card arrives sends nothing.
      if (form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled) return;
      form.requestSubmit();
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
    <div
      ref={surface}
      className={offset === null ? 'transition-transform duration-150 ease-out-soft' : undefined}
      style={offset === null ? undefined : { transform: `translateX(${offset}px)` }}
    >
      {children}
    </div>
  );
}
