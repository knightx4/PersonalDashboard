'use client';

import {
  Fragment,
  createContext,
  startTransition,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useFormStatus } from 'react-dom';
import { ArrowRight, EyeOff, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { swipeAxis, swipeFarEnough } from '@/lib/news/quick/swipe';
import type { NewsTopic } from '@/lib/news/issues/topics';
import type { StoryPass } from '@/lib/news/quick/next';
import { hideQuickTopic, passQuickPage, passQuickStory, recordArticleOpened } from './actions';

/**
 * The id of the form Next submits. A swipe on the card (#855) submits the
 * same form with `requestSubmit()`, so both go through one action and one
 * pending state.
 */
export const QUICK_NEXT_FORM = 'quick-read-next';

/**
 * The one button #847 settled on. It records the story whether or not you
 * read it, and the page comes back with the next card.
 */
export function QuickNextForm({ issueId, storyIndex }: { issueId: string; storyIndex: number }) {
  return (
    <form id={QUICK_NEXT_FORM} action={passQuickStory}>
      <input type="hidden" name="issueId" value={issueId} />
      <input type="hidden" name="storyIndex" value={storyIndex} />
      <NextButton />
    </form>
  );
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
  return (
    <form action={passQuickPage}>
      {stories.map((story) => (
        <Fragment key={`${story.issueId}:${story.storyIndex}`}>
          <input type="hidden" name="issueId" value={story.issueId} />
          <input type="hidden" name="storyIndex" value={story.storyIndex} />
        </Fragment>
      ))}
      <NextPageButton />
    </form>
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
 * Fewer like this (plan #861): hides the card's topic from Quick read, and the
 * page comes back with the next card that is not on it. Drawn only on a story
 * that has a topic.
 */
export function HideTopicForm({ topic }: { topic: NewsTopic }) {
  return (
    <form action={hideQuickTopic}>
      <input type="hidden" name="topic" value={topic} />
      <HideTopicButton topic={topic} />
    </form>
  );
}

function HideTopicButton({ topic }: { topic: NewsTopic }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="ghost"
      size="sm"
      pending={pending}
      title={`Stop showing ${topic} stories in Quick read`}
    >
      {!pending && <EyeOff className="size-3.5" strokeWidth={1.75} aria-hidden />}
      {pending ? 'Hiding…' : 'Fewer like this'}
    </Button>
  );
}

/**
 * The article, in a new tab. Opening it records the story as passed while the
 * tab opens, and the card stays so you can come back and press Next.
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
