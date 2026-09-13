'use client';

import { useActionState, useOptimistic, useRef, useState } from 'react';
import { Bot, CircleUser, X } from 'lucide-react';
import { addComment, deleteComment, type CommentActionState } from '@/app/dev/comment-actions';
import { CommentBody } from '@/components/dev/comment-body';
import { Button } from '@/components/ui/button';
import { FieldError, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { MENTION, mentionsDash } from '@/lib/comments/mention';
import { commentWhen, exactTime } from '@/lib/comments/when';
import { useClockNow } from '@/lib/use-clock-now';
import type { CommentAuthor, CommentTarget, DevComment } from '@/lib/comments/load';

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
 * the header once and leaves the column empty under it, the way a chat window
 * does: repeating "Dash 3h ago" four times says the same thing four times.
 *
 * Deleting lives on the message being pointed at. It used to be an X in every
 * header, which is a destructive control standing permanently on every turn of
 * a conversation for the once a month somebody takes one back.
 */
function Message({
  comment,
  target,
  grouped,
}: {
  comment: DevComment;
  target: CommentTarget;
  /** Whether the message above is from the same author, so the header is up already. */
  grouped: boolean;
}) {
  const now = useClockNow();
  const sending = comment.id === PENDING;

  return (
    <li className={cn('group flex gap-2', sending && 'opacity-60')}>
      <div className="flex w-4 shrink-0 justify-center pt-1">
        {!grouped && <AuthorMark author={comment.author} />}
      </div>

      <div className="min-w-0 flex-1 space-y-0.5">
        {!grouped && (
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-small font-semibold text-ink">{AUTHOR_NAME[comment.author]}</span>
            {sending ? (
              <span className="text-small text-ink-muted">Sending…</span>
            ) : (
              <time
                dateTime={comment.createdAt}
                title={exactTime(comment.createdAt)}
                className="tabular text-small text-ink-muted"
              >
                {commentWhen(comment.createdAt, now)}
              </time>
            )}
          </div>
        )}
        <div className="text-body text-ink">
          <CommentBody body={comment.body} />
        </div>
      </div>

      {!sending && (
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
  /**
   * Draw the waiting line with nothing in flight, for the surface gallery.
   *
   * The line is up for the few seconds a tagged comment takes to come back,
   * which is not long enough to photograph and not a state a fixture can
   * otherwise reach. Left off everywhere in the app.
   */
  awaitingReply?: boolean;
}) {
  const [state, action, pending] = useActionState(
    submit?.action ?? addComment,
    {} as CommentActionState,
  );
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  /** Kept only so a failed write can hand the words back rather than lose them. */
  const [sent, setSent] = useState('');

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

  const trigger = submit?.label ?? label ?? (thread.length === 0 ? 'Add a comment' : 'Add another');
  // Nothing is coming back from an action of somebody else's, so the line
  // saying an answer is on its way would be describing a wait that is not
  // happening.
  const asking = awaitingReply || (!submit && pending && mentionsDash(sent));
  /** Whether what is in the box right now would reach Dash. */
  const tagged = mentionsDash(draft);

  return (
    <div className="space-y-2">
      {shown.length > 0 && (
        <ul className="space-y-2.5">
          {shown.map((comment, index) => (
            <Message
              key={comment.id}
              comment={comment}
              target={target}
              // A message on its way keeps its own header whatever is above it:
              // "Sending…" is the one thing that header has to say.
              grouped={comment.id !== PENDING && shown[index - 1]?.author === comment.author}
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

      {!writing ? (
        <button
          type="button"
          onClick={() => setWriting(true)}
          className="press -ml-1.5 inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-ui text-ink-ghost hover:bg-sunken hover:text-ink-muted"
        >
          <span aria-hidden>+</span>
          {trigger}
        </button>
      ) : (
        <form
          // The box empties and the comment appears before the write is sent,
          // rather than after it comes back.
          action={(formData: FormData) => {
            const body = String(formData.get('body') ?? '').trim();
            if (!body) return;
            setSent(body);
            setDraft('');
            setWriting(false);
            showOptimistically(body);
            action(formData);
          }}
          className="space-y-2"
        >
          <input type="hidden" name="target" value={target} />
          <input type="hidden" name="id" value={id} />
          <Textarea
            ref={box}
            name="body"
            rows={2}
            className="min-h-12"
            autoFocus
            placeholder={placeholder}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />

          {/* Which of the two things you are writing, while you are writing it.
              The only sign used to be the save button changing to Asking once
              it was already sending, by which point the choice had been made.
              Left off a box writing somewhere else: a note answering a blocked
              bug goes back in the queue whatever is in it, and nothing here
              would be reading the tag. */}
          {!submit && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-small text-ink-muted">
                {tagged
                  ? 'Dash will read this and reply in the thread.'
                  : 'A note on the row. Nothing reads it.'}
              </p>
              {!tagged && (
                <button
                  type="button"
                  // In front of what you have written, which is where a comment
                  // addressed to somebody starts.
                  onClick={() => {
                    setDraft((current) => (current ? `${MENTION} ${current}` : `${MENTION} `));
                    box.current?.focus();
                  }}
                  className="press rounded-control px-1.5 py-0.5 text-small text-ink-ghost hover:bg-sunken hover:text-ink"
                >
                  Tag {MENTION}
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1">
            <Button type="submit" size="sm">
              {submit?.label ?? 'Save'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setWriting(false)}>
              Cancel
            </Button>
            <FieldError>{state.error}</FieldError>
          </div>
        </form>
      )}

      {/* The box is closed by the time a failure can arrive, so the reason has
          to have somewhere of its own to land. */}
      {!writing && state.error && <FieldError>{state.error}</FieldError>}
    </div>
  );
}
