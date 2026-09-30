'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquarePlus } from 'lucide-react';
import {
  openFeedbackCount,
  submitFeedback,
  triageFiled,
  type FeedbackActionState,
} from '@/app/dev/bugs/actions';
import { submitIdea, type IdeaActionState } from '@/app/dev/ideas/actions';
import { Button } from '@/components/ui/button';
import { RunRoutineButton } from '@/components/feedback/run-routine-button';
import { TriageNote } from '@/components/feedback/triage-note';
import { FieldError, Input, Label, Select, Textarea } from '@/components/ui/field';
import { Popover } from '@/components/ui/popover';
import { cn } from '@/lib/cn';
import type { FeedbackKind } from '@/lib/feedback/load';
import type { TriageView } from '@/lib/feedback/triage';
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
 * Two tabs, two destinations. A note (a bug or a request) is a row in the
 * notes queue; an idea is a row in `ideas`, which is not worked and has no
 * queue — it is a thing that might be worth doing one day. They share a panel
 * because they share the moment: the thought arrives while you are looking at
 * the thing, and which of them it is, is not something anybody should have to
 * decide by picking a page to navigate to.
 *
 * There was a Like tab too, and it is gone (note f36f9542): recording what
 * works was not something anybody wanted to do from here. Likes already filed
 * stay in the queue as they were, for the vision review to read.
 *
 * Two tabs for the owner. The note alone for everybody else, with no tab row,
 * no code box and nothing under the form: see `isOwner` below for what goes
 * and why.
 */
type Kind = 'note' | 'idea';

/**
 * What each tab is called and what it asks for.
 *
 * A table rather than ternaries down the form. The tabs were two and
 * every difference between them was written inline; at three that reads as a
 * puzzle, and a fourth destination would have to be added in five places.
 *
 * Bug and Feature are one tab (note 55b53dc9). Both went to the same queue,
 * and triage now sorts a note into one or the other as it is saved
 * (lib/feedback/triage-run.ts), so picking was a question nobody needed to
 * answer. The note is saved as a request and triage turns it into a bug when
 * it is sure it is one.
 */
const KINDS: ReadonlyArray<{
  id: Kind;
  tab: string;
  prompt: string;
  placeholder: string;
}> = [
  {
    id: 'note',
    tab: 'Bug or feature',
    prompt: 'What should change?',
    placeholder:
      'What went wrong, or what it should do. It is sorted into a bug or a request for you.',
  },
  {
    id: 'idea',
    tab: 'Idea',
    prompt: 'What is the idea?',
    placeholder: 'The thought, in a sentence. Nothing is scheduled by writing it down.',
  },
];

/** The kind a note files as: a request, until triage says it is a bug. */
const NOTE_KIND: FeedbackKind = 'feature';

const KIND = Object.fromEntries(KINDS.map((entry) => [entry.id, entry])) as Record<
  Kind,
  (typeof KINDS)[number]
>;

export function FeedbackButton({
  allHref = '/dev/bugs',
  isOwner = false,
}: {
  allHref?: string;
  /**
   * Whether the signed-in account owns this app. Passed down from the shell,
   * which read it once on the server: the check is server-only and costs a
   * round trip, so a client component may not ask for itself.
   *
   * It decides how much of this panel there is. Everyone gets the capture --
   * a bug is a bug whoever hit it -- and the rest of what is in here is the
   * dev workspace poking through the header: the Idea tab writes to a list
   * only the owner can see, the submit code guards a queue only they work,
   * and the routine section below the form is that queue's own controls.
   *
   * Omitted means "not the owner": the smaller panel, which files a note and
   * says so, rather than one offering buttons whose actions would refuse.
   */
  isOwner?: boolean;
} = {}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>('note');
  // No Idea tab for everybody else. Not a tab that refuses: `submitIdea`
  // turns a non-owner away before it looks at anything (#417), so offering it
  // would be offering a button whose only answer is no.
  const tabs = isOwner ? KINDS : KINDS.filter((entry) => entry.id !== 'idea');
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [noteState, noteAction, notePending] = useActionState(
    submitFeedback,
    {} as FeedbackActionState,
  );
  const [ideaState, ideaAction, ideaPending] = useActionState(submitIdea, {} as IdeaActionState);

  // Two writers behind one form, because the two tables are two writers. The
  // form takes whichever the open tab files to, and reports that one's result:
  // an error left over from the other tab is an answer to a question nobody is
  // looking at any more.
  const idea = kind === 'idea';
  const action = idea ? ideaAction : noteAction;
  const state: FeedbackActionState = idea ? ideaState : noteState;
  const pending = idea ? ideaPending : notePending;

  usePopover({ open, onClose: () => setOpen(false), panelRef, triggerRef });

  // What Jev made of the row just saved (plan #1179), asked for once the save
  // has returned so Send never waits on it. Keyed on the row's id: a second
  // note replaces the first one's triage, and switching tabs shows the triage
  // of whatever that tab last saved.
  const filedId = state.filed?.id ?? null;
  const filedTable = state.filed?.table ?? null;
  const [triage, setTriage] = useState<{ id: string; view: TriageView | null } | null>(null);
  useEffect(() => {
    if (!filedId || !filedTable) return;
    let cancelled = false;
    void triageFiled({ table: filedTable, id: filedId })
      .then((view) => {
        if (!cancelled) setTriage({ id: filedId, view });
      })
      .catch(() => {
        if (!cancelled) setTriage({ id: filedId, view: null });
      });
    return () => {
      cancelled = true;
    };
  }, [filedId, filedTable]);
  const triaged = filedId !== null && triage?.id === filedId ? triage.view : null;
  const triaging = Boolean(filedId && triage?.id !== filedId);

  // Counted when the panel opens, and again after a note is filed from it, so
  // the number beside "Run Feature Routine" is the queue as it stands rather
  // than as it was when the layout was rendered. A failure leaves it unknown,
  // and the button simply shows no count.
  const [openCount, setOpenCount] = useState<number | null>(null);
  // The notes queue's own message: an idea does not go into that queue, so
  // filing one is not a reason to re-count it.
  const submitted = noteState.message;
  useEffect(() => {
    // The count is the owner's queue, and `openFeedbackCount` is locked to
    // them (#417). Not fetched at all for anyone else, rather than fetched and
    // swallowed: the number has nowhere to go once the section below the form
    // is gone.
    if (!open || !isOwner) return;
    let cancelled = false;
    void openFeedbackCount()
      .then((count) => {
        if (!cancelled) setOpenCount(count);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, submitted, isOwner]);

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
            <input type="hidden" name="kind" value={idea ? 'idea' : NOTE_KIND} />

            {/* One tab is not a choice, so a panel with only the note in it
                draws no tab row. */}
            {tabs.length > 1 && (
              <div className="flex gap-1">
                {tabs.map(({ id, tab }) => (
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
            )}

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

            {/* The owner's, and only theirs. It is the code that guards the
                dev workspace's own writing, and `submitFeedback` asks for it
                from the owner alone -- a second account has nothing to type
                here and no way of knowing it. */}
            {isOwner && (
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
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? 'Saving…' : 'Send'}
              </Button>
              {/* Saves the idea and hands it straight to Dash to shape into
                  the plan, the same as Shape on the ideas page. */}
              {idea && (
                <Button
                  type="submit"
                  name="then"
                  value="shape"
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                >
                  Send and shape
                </Button>
              )}
            </div>

            <FieldError>{state.error}</FieldError>
            {state.message && <p className="text-ui text-accent">{state.message}</p>}
            {triaging && <p className="text-small text-ink-muted">Sorting it…</p>}
            <TriageNote view={triaged} onNavigate={() => setOpen(false)} />
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
          {/* All of it the owner's. The routine, the count and both ways
              through land in /dev, which another account cannot open at all
              (#416) -- so for them the panel is the form and nothing else: you
              write the note, it says it saved it, and that is the whole of
              what filing one is. */}
          {isOwner && (
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
          )}
        </Popover>
      )}
    </div>
  );
}
