'use client';

import { useActionState, useOptimistic, useRef, useState } from 'react';
import { ArrowUp, Bot, CircleUser, X } from 'lucide-react';
import { addComment, deleteComment, type CommentActionState } from '@/app/dev/comment-actions';
import { CommentBody } from '@/components/dev/comment-body';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { ComposeBody, ComposeBox, FieldError } from '@/components/ui/field';
import { awaitingDash } from '@/lib/comments/awaiting';
import { MENTION, mentionsDash } from '@/lib/comments/mention';
import { commentWhen, exactTime, shortWhen } from '@/lib/comments/when';
import type { PlanRefTitles } from '@/lib/comments/refs';
import { useClockNow } from '@/lib/use-clock-now';
import type { CommentAuthor, CommentTarget, DevComment } from '@/lib/comments/load';
import { PaidHint } from '@/components/ui/paid-hint';

/**
 * The thread on one row of the dev pages, and the box for adding to it.
 *
 * The same component on an idea, a plan step and a raise, because the thing
 * being written is the same thing in all three places: something you want
 * attached to that row rather than to a transcript. It is a note until `@dash`
 * appears in it, which is what makes it worth having on rows nobody is waiting
 * on.
 *
 * The list is the whole thread including a session's replies, told apart by who
 * wrote each one rather than by where it sits.
 */

function DeleteComment({ id, target }: { id: string; target: CommentTarget }) {
  const [state, action, pending] = useActionState(deleteComment, {} as CommentActionState);

  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="target" value={target} />
      <FieldError>{state.error}</FieldError>
      <button
        type="submit"
        title="Delete this comment"
        disabled={pending}
        className="press flex size-6 items-center justify-center rounded-lg text-ink-ghost transition-colors duration-150 hover:bg-sunken hover:text-ink disabled:opacity-50"
      >
        <X className="size-3.5" strokeWidth={2} aria-hidden />
        <span className="sr-only">Delete this comment</span>
      </button>
    </form>
  );
}

/** The id the not-yet-written comment carries, so it can be told apart. */
const PENDING = 'pending';

/** What the interface calls each of you. The stored author stays `claude`. */
const AUTHOR_NAME: Record<CommentAuthor, string> = { me: 'You', claude: 'Dash' };

/**
 * Who is talking, as a shape rather than as another word.
 *
 * The name says it too, but a thread is read by running down the left edge of
 * it, and two glyphs are told apart there in a way that "You" and "Dash" set
 * in the same face are not. Ink, not colour: whose turn it is is none of the
 * five things a hue is allowed to mean.
 */
function AuthorMark({ author }: { author: CommentAuthor }) {
  const Glyph = author === 'claude' ? Bot : CircleUser;
  return <Glyph className="size-3.5 text-ink-ghost" strokeWidth={2} aria-hidden />;
}

/**
 * One message: who wrote it, when, and what they said.
 *
 * A row rather than a bubble or a card. The mark sits in a column of its own
 * and the body hangs off it, so alignment does the grouping and no turn needs
 * a frame around it -- laws 11 and 13. A run of messages from one author draws
 * the header once, the way a chat window does: repeating "Dash 3h ago" four
 * times says the same thing four times. Under that header the strip carries
 * the short time on hover, so a message in the middle of a run can still be
 * dated without a header of its own.
 *
 * Deleting lives on the message being pointed at. It used to be an X in every
 * header, which is a destructive control standing permanently on every turn of
 * a conversation for the once a month somebody takes one back.
 */
function Message({
  comment,
  target,
  grouped,
  titles,
}: {
  comment: DevComment;
  target: CommentTarget;
  /** Whether the message above is from the same author, so the header is up already. */
  grouped: boolean;
  /** What each step number in the body is called, for the hover text. */
  titles?: PlanRefTitles;
}) {
  const now = useClockNow();
  // The one thing still read off the pending id. A comment that has not been
  // written yet has no id to delete by, so the control waits for the real row;
  // everything else about it is drawn exactly as a comment that landed.
  const unsent = comment.id === PENDING;

  return (
    <li className="group flex gap-2">
      {/* The strip the author mark stands in, and where a grouped message says
          when it was written. A run draws one header, so every message under
          the first had no time on it at all until #641; the short form fits
          the roughly 40px there is here where `commentWhen`'s date does not
          -- #640. Out of the flow and right-aligned, so the column keeps its
          16px and nothing shifts when the string appears. */}
      <div className="relative flex w-4 shrink-0 justify-center pt-1">
        {grouped ? (
          <time
            dateTime={comment.createdAt}
            title={exactTime(comment.createdAt)}
            className="tabular absolute top-1 right-0 whitespace-nowrap text-micro text-ink-ghost transition-opacity duration-150 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
          >
            {shortWhen(comment.createdAt, now)}
          </time>
        ) : (
          <AuthorMark author={comment.author} />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-0.5">
        {!grouped && (
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-small font-semibold text-ink">{AUTHOR_NAME[comment.author]}</span>
            <time
              dateTime={comment.createdAt}
              title={exactTime(comment.createdAt)}
              className="tabular text-small text-ink-muted"
            >
              {commentWhen(comment.createdAt, now)}
            </time>
          </div>
        )}
        <div className="text-body text-ink">
          <CommentBody body={comment.body} titles={titles} />
        </div>
      </div>

      {!unsent && (
        <div className="shrink-0 transition-opacity duration-150 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          <DeleteComment id={comment.id} target={target} />
        </div>
      )}
    </li>
  );
}

/**
 * An action the box sends to instead of `addComment`.
 *
 * One box, whatever it is for. A blocked bug note is the case that needs it:
 * the answer to the question a run left is a comment like any other, and it
 * also puts the note back in the queue, so the write goes through
 * `respondToFeedback` -- #393. Without this the card carries two text boxes
 * that look alike and do different things.
 */
export type CommentSubmit = {
  action: (prev: CommentActionState, formData: FormData) => Promise<CommentActionState>;
  /** What the trigger and the save button say. */
  label: string;
};

/**
 * The thread, the box, and the comment that is on its way.
 *
 * These were two components, and the split is what made posting feel slow. The
 * form owned the write, so nothing could be shown in the list until the server
 * action came back -- and a tagged comment does not come back until a model has
 * answered it, which is seconds. You wrote a sentence, pressed Save, and
 * watched your own words sit in a box doing nothing.
 *
 * So the write lives here, where the list is: your comment is in the thread on
 * the press, the way it is everywhere else that people talk to each other, and
 * the reply arrives under it when there is one. If the write fails the
 * optimistic row goes away again and the draft comes back in the box, which is
 * the part that makes posting first honest rather than merely quick.
 */
export function CommentThread({
  target,
  id,
  thread,
  label,
  submit,
  placeholder = 'A note on this row, or a question for Dash.',
  awaitingReply = false,
  composerOpen = false,
  titles,
}: {
  target: CommentTarget;
  /** The row being commented on, not the comment. */
  id: string;
  thread: readonly DevComment[];
  /** What the trigger says when the thread is empty. */
  label?: string;
  /** Where the box writes, when it is not a plain comment. */
  submit?: CommentSubmit;
  placeholder?: string;
  /** What each step number in a comment is called, for the hover text. */
  titles?: PlanRefTitles;
  /**
   * Draw the waiting line with nothing in flight, for the surface gallery.
   *
   * The line is up for the few seconds a tagged comment takes to come back,
   * which is not long enough to photograph and not a state a fixture can
   * otherwise reach. Left off everywhere in the app.
   */
  awaitingReply?: boolean;
  /**
   * Open the box with nothing typed in it, for the surface gallery.
   *
   * The box is a trigger until it is pressed -- law 14 -- so it is only ever
   * on screen while somebody is part-way through a sentence, which is a state
   * a fixture cannot reach and a screenshot cannot catch. Left off everywhere
   * in the app.
   */
  composerOpen?: boolean;
}) {
  // The write is not waited on: the comment is in the thread the moment it is
  // written, and a failure puts the words back in the box. Nothing on screen
  // is keyed to the request being in flight any more.
  const [state, action] = useActionState(submit?.action ?? addComment, {} as CommentActionState);
  const [writing, setWriting] = useState(composerOpen);
  const [draft, setDraft] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  /** So Enter can send without the button being the only way to submit. */
  const form = useRef<HTMLFormElement>(null);
  /** Kept only so a failed write can hand the words back rather than lose them. */
  const [sent, setSent] = useState('');
  /**
   * The box has been sent from and is not to be drawn, whatever `writing` and
   * `draft` still say.
   *
   * `setDraft('')` and `setWriting(false)` are ordinary state, and the form
   * action they are called from runs inside a transition that stays pending
   * until the write comes back -- which for a tagged comment is however long a
   * reply takes. React holds an ordinary update for that whole time and shows
   * only optimistic ones, so the words sat in the box, whole, while the
   * comment they had already been posted as stood in the thread above them
   * (note ba9b608a). The two setters below are still what empties the box; this
   * is what makes the emptying visible on the press. Both land in the same
   * commit when the transition ends, so nothing flickers back.
   */
  const [posted, markPosted] = useOptimistic<boolean, void>(false, () => true);

  const [shown, showOptimistically] = useOptimistic(
    thread,
    (current: readonly DevComment[], body: string): DevComment[] => [
      ...current,
      { id: PENDING, author: 'me', body, createdAt: new Date().toISOString() },
    ],
  );

  // A failed write puts the draft back in the box. Adjusted during render
  // rather than in an effect, the same way the ideas composer does it.
  const [seenError, setSeenError] = useState<string | undefined>(undefined);
  if (state.error !== seenError) {
    setSeenError(state.error);
    if (state.error && sent) {
      setWriting(true);
      setDraft(sent);
    }
  }

  const now = useClockNow();
  const trigger = submit?.label ?? label ?? (thread.length === 0 ? 'Add a comment' : 'Add another');
  /** The send control has no words on it, so its name is read rather than seen. */
  const sendLabel = submit?.label ?? 'Send';
  // A raise is a question put to you, so anything you write on one reaches
  // Dash whether or not it carries the tag -- #541. Everywhere else the tag is
  // what does it.
  const reaches = (body: string) => target === 'raise' || mentionsDash(body);
  // Nothing is coming back from an action of somebody else's, so the line
  // saying an answer is on its way would be describing a wait that is not
  // happening.
  //
  // Read off the thread rather than off the write being in flight. The write
  // takes a second and the session it starts takes minutes, so tying the line
  // to `pending` had it up for the wrong one of the two -- and gone entirely
  // after a reload. `awaitingDash` holds it until Dash answers or until the
  // wait has gone on longer than an answer ever takes.
  const asking = awaitingReply || (!submit && awaitingDash(shown, target, now));
  /** Whether what is in the box right now would reach Dash. */
  const tagged = reaches(draft);

  const last = shown[shown.length - 1];

  const messages = (
    <>
      {shown.length > 0 && (
        <ul className="space-y-2.5">
          {shown.map((comment, index) => (
            <Message
              key={comment.id}
              comment={comment}
              target={target}
              // Grouped on the same rule as any other turn. It used to be
              // forced apart so it could say "Sending…"; a comment that posts
              // straight into the thread has nothing to say that the one above
              // it has not already said.
              grouped={shown[index - 1]?.author === comment.author}
              titles={titles}
            />
          ))}

          {/* Where the answer is going to appear, while it is being written.
              This replaces the reply that used to be posted into the thread
              saying a session had been started -- that was a comment nobody
              wrote, left behind above the real answer forever. A line that is
              only there while you wait says the same thing and does not. */}
          {asking && (
            <li className="flex gap-2" aria-live="polite">
              <div className="flex w-4 shrink-0 justify-center pt-1">
                <AuthorMark author="claude" />
              </div>
              <div className="min-w-0 flex-1 space-y-0.5">
                <span className="text-small font-semibold text-ink-muted">Dash</span>
                <p className="text-body text-ink-muted">Reading the row and replying…</p>
              </div>
            </li>
          )}
        </ul>
      )}

      {!writing || posted ? (
        <button
          type="button"
          onClick={() => setWriting(true)}
          // Off for the moment the last comment is still going out. Opening
          // the box again in that window would hand back the box we have just
          // optimistically emptied, still holding the words, and anything
          // typed into it would be wiped when the real clear lands with the
          // write. A control that is visibly off for a second says that
          // better than one that swallows the press.
          disabled={posted}
          className="press -ml-1.5 inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-ui text-ink-ghost hover:bg-sunken hover:text-ink-muted disabled:opacity-50"
        >
          <span aria-hidden>+</span>
          {trigger}
        </button>
      ) : (
        <form
          ref={form}
          // The box empties and the comment appears before the write is sent,
          // rather than after it comes back.
          action={(formData: FormData) => {
            const body = String(formData.get('body') ?? '').trim();
            if (!body) return;
            setSent(body);
            setDraft('');
            setWriting(false);
            // On the optimistic channel with the comment itself, so the box
            // goes at the same moment the comment appears rather than when the
            // write returns.
            markPosted();
            showOptimistically(body);
            action(formData);
          }}
          // Escape is the way out from the keyboard, and there is no Cancel
          // button any more, so an empty box also closes when focus leaves it
          // -- which is the only way out a phone has. Words already typed keep
          // the box open: closing it because you tapped something else would
          // throw them away.
          onBlur={(event) => {
            if (draft.trim()) return;
            if (event.currentTarget.contains(event.relatedTarget)) return;
            setWriting(false);
          }}
        >
          <input type="hidden" name="target" value={target} />
          <input type="hidden" name="id" value={id} />

          {/* One box: the words, what they will reach, and the control that
              sends them. A Send and a Cancel standing underneath were two
              buttons for what a chat window does with one glyph and the
              Escape key, and they made a message read as a form being
              filled in -- #591. */}
          <ComposeBox>
            {/* Enter sends and shift-Enter breaks the line, which is what
                every chat window does and what makes this one feel like a
                message rather than a field with a Save under it. Escape puts
                the box away. */}
            <div className="flex items-start gap-2">
              {/* Dash's own head, at the left of the line you type on, puts
                  the tag in front of what you have written (note 66f5a513).
                  It replaced a "Tag @dash" word in the row underneath, which
                  sat on the far side of the box from where a comment
                  addressed to somebody starts. Lit once the tag is in, so it
                  also says who will read this. Left off a box writing
                  somewhere else, where nothing reads the tag. */}
              {!submit && (
                <button
                  type="button"
                  // Keeps the caret where it is. Without this the box loses
                  // focus on the press, and a browser that does not focus a
                  // button on click -- Safari, Firefox on a Mac -- hands the
                  // blur no target inside the form, so an empty box would
                  // close under the tag before the tag ran.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (!tagged) {
                      setDraft((current) => (current ? `${MENTION} ${current}` : `${MENTION} `));
                    }
                    box.current?.focus();
                  }}
                  aria-pressed={tagged}
                  title={tagged ? 'Dash will read this' : `Tag ${MENTION}`}
                  className={
                    // ui-ok: hand-rolled-box -- the subtle circle is what note 66f5a513 asked for, to set Dash's head apart from the words beside it.
                    'press -ml-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors duration-150 ' +
                    (tagged
                      ? 'border-accent bg-accent-tint text-accent'
                      : 'border-control text-ink-ghost hover:bg-sunken hover:text-ink')
                  }
                >
                  <Bot className="size-3.5" strokeWidth={2} aria-hidden />
                  <span className="sr-only">
                    {tagged ? 'Dash will read this' : `Tag ${MENTION}`}
                  </span>
                </button>
              )}
              <ComposeBody
                ref={box}
                name="body"
                rows={1}
                autoFocus
                placeholder={placeholder}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setWriting(false);
                    return;
                  }
                  if (event.key !== 'Enter' || event.shiftKey) return;
                  // A composing keystroke is part of typing a character, not a
                  // send: an IME candidate confirmed with Enter would post the
                  // half-written word otherwise.
                  if (event.nativeEvent.isComposing) return;
                  if (!draft.trim()) return;
                  event.preventDefault();
                  form.current?.requestSubmit();
                }}
              />
            </div>

            <div className="mt-1 flex items-end gap-1">
              {/* Which of the two things you are writing, while you are
                  writing it. The only sign used to be the save button changing
                  to Asking once it was already sending, by which point the
                  choice had been made. Left off a box writing somewhere else:
                  a note answering a blocked bug goes back in the queue
                  whatever is in it, and nothing here would be reading the
                  tag. */}
              {!submit && (
                <p className="min-w-0 flex-1 text-small text-ink-muted">
                  {target === 'raise'
                    ? 'This is your answer. A session acts on it and replies in the thread.'
                    : tagged
                      ? 'Dash will read this and reply in the thread.'
                      : 'A note on the row. Nothing reads it.'}
                </p>
              )}
              {/* Only a tagged comment is answered by Dash; the rest are free. */}
              {!submit && tagged && (
                <PaidHint
                  action="app/dev/comment-actions.ts#addComment"
                  what="Cost of Dash's reply"
                  align="end"
                  className="self-center"
                />
              )}
              {/* A glyph, so the send control is the same size wherever it
                  sits. What a caller's own action is called -- "Answer and
                  reopen" on a blocked bug note -- is what a screen reader
                  reads and what the tooltip says, rather than words printed
                  over the arrow. */}
              <Button
                type="submit"
                size="sm"
                className="ml-auto size-7 shrink-0 px-0"
                disabled={!draft.trim()}
                title={sendLabel}
              >
                <ArrowUp className="size-4" strokeWidth={2} aria-hidden />
                <span className="sr-only">{sendLabel}</span>
              </Button>
            </div>
          </ComposeBox>

          <FieldError>{state.error}</FieldError>
        </form>
      )}

      {/* The box is closed by the time a failure can arrive, so the reason has
          to have somewhere of its own to land. */}
      {!writing && state.error && <FieldError>{state.error}</FieldError>}
    </>
  );

  // Nothing to fold and nothing to head: a row with no comments on it is the
  // button that starts one, and a "0 comments" heading over it would be a
  // section announcing that it has nothing to say -- laws 1 and 9.
  if (shown.length === 0) return <div className="space-y-2">{messages}</div>;

  // A thread reads as a thread: its own heading, its own indent, and a fold,
  // which is what a card carrying a conversation twice as long as the idea
  // above it needed. The closed line carries the count and the last turn, so
  // opening it is a choice rather than a check -- law 10. Open by default,
  // because a comment you cannot see is a comment nobody answers.
  //
  // The fold sits on a recessed ground so you can see where the row stops and
  // the conversation starts; before this it was text on the same background as
  // everything above it. A ground and not a frame: all five callers --
  // plan-view, ideas-view, raised-view, conversations-view, feedback-list --
  // already draw this inside a card, and a border inside that border is what
  // law 11 rules out. `bg-canvas` is the well inside a card rather than the
  // page ground, which is what makes it recede in all four themes.
  //
  // The summary is inside the panel rather than over it, so the count and the
  // last turn are the panel's heading instead of a line floating above it.
  return (
    <Disclosure
      className="mt-1 rounded-lg bg-canvas card-pad-dense"
      defaultOpen
      title={`${shown.length} ${shown.length === 1 ? 'comment' : 'comments'}`}
      meta={
        last && last.id !== PENDING
          ? `${AUTHOR_NAME[last.author]}, ${commentWhen(last.createdAt, now)}`
          : undefined
      }
    >
      <div className="space-y-2">{messages}</div>
    </Disclosure>
  );
}
