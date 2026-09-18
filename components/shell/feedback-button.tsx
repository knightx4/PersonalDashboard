'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquarePlus } from 'lucide-react';
import {
  openFeedbackCount,
  submitFeedback,
  type FeedbackActionState,
} from '@/app/dev/bugs/actions';
import { submitIdea, type IdeaActionState } from '@/app/dev/ideas/actions';
import { Button } from '@/components/ui/button';
import { RunRoutineButton } from '@/components/feedback/run-routine-button';
import { FieldError, Input, Label, Select, Textarea } from '@/components/ui/field';
import { Popover } from '@/components/ui/popover';
import { cn } from '@/lib/cn';
import { MODULES, moduleForPath } from '@/lib/modules';
import { usePopover } from '@/lib/use-popover';

/**
 * Always-available capture for bugs, requests and ideas.
 *
 * It lives in the header so the thought can be written down where it occurs,
 * and it records the page you were on — half of every bug report is "where
 * were you when it happened", and that half is free.
 *
 * One button, one queue, both workspaces. `allHref` only decides which
 * workspace's rendering of that queue you land on, so following the link does
 * not throw you out of the app you were using.
 *
 * Three tabs, two destinations. A bug and a request are the same row in the
 * notes queue and differ only by kind; an idea is a row in `ideas`, which is
 * not worked and has no queue — it is a thing that might be worth doing one
 * day. They share a panel because they share the moment: the thought arrives
 * while you are looking at the thing, and which of the three it is, is not
 * something anybody should have to decide by picking a page to navigate to.
 */
type Kind = 'bug' | 'feature' | 'idea';

/**
 * What each tab is called and what it asks for.
 *
 * A table rather than three ternaries down the form. The tabs were two and
 * every difference between them was written inline; at three that reads as a
 * puzzle, and a fourth destination would have to be added in five places.
 */
const KINDS: ReadonlyArray<{
  id: Kind;
  tab: string;
  prompt: string;
  placeholder: string;
}> = [
  {
    id: 'bug',
    tab: 'Bug',
    prompt: 'What went wrong?',
    placeholder: 'What you did, what happened, what you expected.',
  },
  {
    id: 'feature',
    tab: 'Feature',
    prompt: 'What should it do?',
    placeholder: 'The change, and what it would let you do.',
  },
  {
    id: 'idea',
    tab: 'Idea',
    prompt: 'What is the idea?',
    placeholder: 'The thought, in a sentence. Nothing is scheduled by writing it down.',
  },
];

const KIND = Object.fromEntries(KINDS.map((entry) => [entry.id, entry])) as Record<
  Kind,
  (typeof KINDS)[number]
>;

export function FeedbackButton({
  allHref = '/dev/bugs',
}: {
  allHref?: string;
} = {}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>('feature');
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [noteState, noteAction, notePending] = useActionState(
    submitFeedback,
    {} as FeedbackActionState,
  );
  const [ideaState, ideaAction, ideaPending] = useActionState(
    submitIdea,
    {} as IdeaActionState,
  );

  // Two writers behind one form, because the two tables are two writers. The
  // form takes whichever the open tab files to, and reports that one's result:
  // an error left over from the other tab is an answer to a question nobody is
  // looking at any more.
  const idea = kind === 'idea';
  const action = idea ? ideaAction : noteAction;
  const state: FeedbackActionState = idea ? ideaState : noteState;
  const pending = idea ? ideaPending : notePending;

  usePopover({ open, onClose: () => setOpen(false), panelRef, triggerRef });

  // Counted when the panel opens, and again after a note is filed from it, so
  // the number beside "Run Feature Routine" is the queue as it stands rather
  // than as it was when the layout was rendered. A failure leaves it unknown,
  // and the button simply shows no count.
  const [openCount, setOpenCount] = useState<number | null>(null);
  // The notes queue's own message: an idea does not go into that queue, so
  // filing one is not a reason to re-count it.
  const submitted = noteState.message;
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
        title="Report a bug, request a feature, or note an idea"
        className={cn(
          'press flex size-8 items-center justify-center rounded-full transition-colors',
          open
            ? 'bg-accent-tint text-accent'
            : 'text-shell-muted hover:bg-shell-hover hover:text-shell-ink',
        )}
      >
        <MessageSquarePlus className="size-4" aria-hidden />
        <span className="sr-only">Report a bug, request a feature, or note an idea</span>
      </button>

      {open && (
        <Popover
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Send feedback"
          tabIndex={-1}
          padding="panel"
          className="sm:w-88"
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
              {KINDS.map(({ id, tab }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setKind(id)}
                  className={cn(
                    'flex-1 rounded-lg px-3 py-1.5 text-ui font-medium transition-colors',
                    kind === id
                      ? 'bg-accent-tint text-accent'
                      : 'text-ink-muted hover:bg-canvas hover:text-ink',
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div>
              <Label htmlFor="feedback_body">{KIND[kind].prompt}</Label>
              <Textarea
                id="feedback_body"
                name="body"
                rows={4}
                required
                placeholder={KIND[kind].placeholder}
              />
              {/* Where you were standing. It is the note's page path, and on
                  the idea tab it is only what proposed the workspace below --
                  an idea is about a part of the app, not about a screen. */}
              <p className="mt-1 text-small text-ink-muted">
                {idea
                  ? 'Ideas live on the ideas page, not in the notes queue.'
                  : `Saved with the page you are on (${pathname}).`}
              </p>
            </div>

            {/* Which workspace it is about, proposed from where you are and
                changeable from there -- the thought you have while looking at
                one workspace is usually about it, and sometimes is not. Keyed
                on the path so walking to another workspace with the panel shut
                proposes the new one rather than the one it first saw. */}
            {idea && (
              <div>
                <Label htmlFor="idea_module">What it is about</Label>
                <Select
                  id="idea_module"
                  name="module"
                  key={pathname}
                  defaultValue={moduleForPath(pathname) ?? ''}
                >
                  <option value="">Everything</option>
                  {MODULES.map((module) => (
                    <option key={module.id} value={module.id}>
                      {module.label}
                    </option>
                  ))}
                </Select>
              </div>
            )}

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
              see, not next to a button that files one more.

              Nothing works the ideas list, so the idea tab gets the way
              through and not the button. Offering to run the notes routine
              under a form that files somewhere else would say the two are one
              queue, which is the whole distinction between them. */}
          <div className="mt-4">
            {idea ? (
              <div className="flex border-t border-border pt-4">
                <Link
                  href="/dev/ideas"
                  onClick={() => setOpen(false)}
                  className="ml-auto text-ui text-accent hover:underline"
                >
                  See all ideas
                </Link>
              </div>
            ) : (
              <RunRoutineButton
                openCount={openCount}
                allHref={allHref}
                onNavigate={() => setOpen(false)}
              />
            )}
          </div>
        </Popover>
      )}
    </div>
  );
}
