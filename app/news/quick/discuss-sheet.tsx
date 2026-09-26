'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot, MessagesSquare, X } from 'lucide-react';
import { TalkThread } from '@/components/talk/talk-thread';
import { Button } from '@/components/ui/button';
import { PaidHint } from '@/components/ui/paid-hint';
import { scrim } from '@/components/ui/popover';
import { DISCUSS_ROUNDS, discussionClosed } from '@/lib/news/quick/discuss';
import type { TalkTurn } from '@/lib/talk/talk';
import { discussQuickStory, loadStoryDiscussion } from './actions';

const ACTION = 'app/news/quick/actions.ts#discussQuickStory';

const closedLine = (turns: readonly TalkTurn[]) =>
  discussionClosed(turns)
    ? `That was round ${DISCUSS_ROUNDS} of ${DISCUSS_ROUNDS}, so the discussion is closed.`
    : null;

/**
 * Discuss, beside the thumbs on a Quick read story (plan #1060). It opens a
 * sheet with the story's discussion: Dash asks what you make of it, and each
 * reply argues the other side or asks what your view rests on, for three
 * rounds (lib/news/quick/discuss.ts).
 *
 * The sheet rises from the bottom on a phone and slides in from the right on
 * a laptop, so the story stays in view above or beside it. It is drawn on
 * document.body rather than inside the card, so the card's swipe never sees
 * a touch in the sheet. The thread is read each time it opens, so reopening a
 * story shows the exchange as the table holds it.
 */
export function DiscussButton({
  issueId,
  storyIndex,
  headline,
}: {
  issueId: string;
  storyIndex: number;
  headline: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={open}
        title="Say what you make of this story and hear the other side"
        onClick={() => setOpen(true)}
      >
        <MessagesSquare className="size-3.5" strokeWidth={1.75} aria-hidden />
        Discuss
      </Button>
      {open && (
        <DiscussSheet
          issueId={issueId}
          storyIndex={storyIndex}
          headline={headline}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function DiscussSheet({
  issueId,
  storyIndex,
  headline,
  onClose,
}: {
  issueId: string;
  storyIndex: number;
  headline: string;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<{ turns: TalkTurn[]; error: string | null } | null>(null);

  useEffect(() => {
    let live = true;
    loadStoryDiscussion(issueId, storyIndex)
      .catch(() => ({ turns: [], error: 'Your discussion could not be read. Try again.' }))
      .then((result) => {
        if (live) setLoaded(result);
      });
    return () => {
      live = false;
    };
  }, [issueId, storyIndex]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const id = `discuss-${issueId}-${storyIndex}`;
  return createPortal(
    <div className="fixed inset-0 z-overlay">
      <button type="button" aria-label="Close the discussion" onClick={onClose} className={scrim} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="absolute inset-x-0 bottom-0 flex max-h-[75dvh] flex-col rounded-t-xl border-t border-border bg-surface md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[min(28rem,100vw)] md:rounded-none md:border-l md:border-t-0"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 id={`${id}-title`} className="text-ui font-semibold text-ink">
                Discuss
              </h2>
              <PaidHint action={ACTION} what="Cost of each reply from Dash" />
            </div>
            <p className="mt-0.5 line-clamp-2 break-words text-ui text-ink-muted">{headline}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="press flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-sunken hover:text-ink"
          >
            <X className="size-4" strokeWidth={2} aria-hidden />
            <span className="sr-only">Close the discussion</span>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
          <div className="flex gap-2">
            <div className="flex w-4 shrink-0 justify-center pt-1">
              <Bot className="size-3.5 text-ink-ghost" strokeWidth={2} aria-hidden />
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
              <span className="text-small font-semibold text-ink">Dash</span>
              <p className="text-body text-ink">
                What do you make of this story? Say what you think, and I will take the other side
                or ask what your view rests on. After {DISCUSS_ROUNDS} rounds I will say where it
                held and where it was thin.
              </p>
            </div>
          </div>

          {loaded === null ? (
            <p className="text-ui text-ink-muted" aria-live="polite">
              Reading the discussion…
            </p>
          ) : loaded.error ? (
            <p className="text-ui text-danger">{loaded.error}</p>
          ) : (
            <TalkThread
              id={id}
              turns={loaded.turns}
              send={(body) => discussQuickStory(issueId, storyIndex, body)}
              label={loaded.turns.length ? 'Reply' : 'Say what you think'}
              placeholder="What you make of it, and why"
              closed={closedLine}
            />
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
