'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { MessageSquarePlus } from 'lucide-react';
import {
  openFeedbackCount,
  submitFeedback,
  type FeedbackActionState,
} from '@/app/shopping/feedback/actions';
import { Button } from '@/components/ui/button';
import { RunRoutineButton } from '@/components/feedback/run-routine-button';
import { FieldError, Input, Label, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { usePopover } from '@/lib/use-popover';

/**
 * Always-available capture for bugs and ideas.
 *
 * It lives in the header so the thought can be written down where it occurs,
 * and it records the page you were on — half of every bug report is "where
 * were you when it happened", and that half is free.
 *
 * One button, one queue, both workspaces. `allHref` only decides which
 * workspace's rendering of that queue you land on, so following the link does
 * not throw you out of the app you were using.
 */
export function FeedbackButton({
  allHref = '/shopping/feedback',
}: {
  allHref?: string;
} = {}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'bug' | 'feature'>('feature');
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [state, action, pending] = useActionState(
    submitFeedback,
    {} as FeedbackActionState,
  );

  usePopover({ open, onClose: () => setOpen(false), panelRef, triggerRef });

  // Counted when the panel opens, and again after a note is filed from it, so
  // the number beside "Run Feature Routine" is the queue as it stands rather
  // than as it was when the layout was rendered. A failure leaves it unknown,
  // and the button simply shows no count.
  const [openCount, setOpenCount] = useState<number | null>(null);
  const submitted = state.message;
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void openFeedbackCount()
      .then((count) => {
        if (!cancelled) setOpenCount(count);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, submitted]);

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Report a bug or request a feature"
        className={cn(
          'press flex size-8 items-center justify-center rounded-full transition-colors',
          open ? 'bg-accent-tint text-accent' : 'text-ink-muted hover:bg-sunken hover:text-ink',
        )}
      >
        <MessageSquarePlus className="size-4" aria-hidden />
        <span className="sr-only">Report a bug or request a feature</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Send feedback"
          tabIndex={-1}
          // On a phone the button sits far enough right that a panel anchored
          // to it hangs off the left edge of the screen, where nothing can
          // scroll it back into view -- and Safari answers a field focused out
          // there by zooming the whole page out to reach it. Pinned to the
          // viewport below the header until there is room to anchor it.
          className="fixed inset-x-4 top-16 z-50 rounded-card border border-border bg-surface p-4 shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-10 sm:w-88"
        >
          <form action={action} className="flex flex-col gap-3">
            <input type="hidden" name="page_path" value={pathname} />
            <input
              type="hidden"
              name="user_agent"
              value={typeof navigator === 'undefined' ? '' : navigator.userAgent}
            />
            <input type="hidden" name="kind" value={kind} />

            <div className="flex gap-1">
              {(['bug', 'feature'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setKind(option)}
                  className={cn(
                    'flex-1 rounded-lg px-3 py-1.5 text-ui font-medium transition-colors',
                    kind === option
                      ? 'bg-accent-tint text-accent'
                      : 'text-ink-muted hover:bg-canvas hover:text-ink',
                  )}
                >
                  {option === 'bug' ? 'Bug' : 'Feature'}
                </button>
              ))}
            </div>

            <div>
              <Label htmlFor="feedback_body">
                {kind === 'bug' ? 'What went wrong?' : 'What should it do?'}
              </Label>
              <Textarea
                id="feedback_body"
                name="body"
                rows={4}
                required
                placeholder={
                  kind === 'bug'
                    ? 'What you did, what happened, what you expected.'
                    : 'The change, and what it would let you do.'
                }
              />
              <p className="mt-1 text-small text-ink-muted">
                Saved with the page you are on ({pathname}).
              </p>
            </div>

            <div>
              <Label htmlFor="feedback_code">Code</Label>
              <Input
                id="feedback_code"
                name="code"
                type="password"
                autoComplete="off"
                required
                placeholder="Submit code"
              />
            </div>

            <Button type="submit" size="sm" disabled={pending} className="self-start">
              {pending ? 'Saving…' : 'Send'}
            </Button>

            <FieldError>{state.error}</FieldError>
            {state.message && (
              <p className="text-ui text-accent">{state.message}</p>
            )}
          </form>

          {/* Its own section below the form, not a link on the Send row: it is
              the other thing you can do from here, and it acts on the whole
              queue rather than on what you just typed. "See all" sits here for
              the same reason -- it belongs beside the count of what there is to
              see, not next to a button that files one more. */}
          <div className="mt-4">
            <RunRoutineButton
              openCount={openCount}
              allHref={allHref}
              onNavigate={() => setOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
