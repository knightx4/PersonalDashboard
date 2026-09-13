'use client';

import { useActionState, useOptimistic, useState } from 'react';
import { X } from 'lucide-react';
import { addComment, deleteComment, type CommentActionState } from '@/app/dev/comment-actions';
import { Button } from '@/components/ui/button';
import { FieldError, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { mentionsDash } from '@/lib/comments/mention';
import type { CommentTarget, DevComment } from '@/lib/comments/load';

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
    <form action={action} className="ml-auto flex items-center gap-1">
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
  placeholder = 'A note on this row. Tag @dash to ask something, or to tell it to do something; without it nothing reads it.',
}: {
  target: CommentTarget;
  /** The row being commented on, not the comment. */
  id: string;
  thread: readonly DevComment[];
  /** What the trigger says when the thread is empty. */
  label?: string;
  placeholder?: string;
}) {
  const [state, action, pending] = useActionState(addComment, {} as CommentActionState);
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState('');
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

  const trigger = label ?? (thread.length === 0 ? 'Add a comment' : 'Add another');
  const asking = pending && mentionsDash(sent);

  return (
    <div className="space-y-2">
      {shown.length > 0 && (
        <ul className="space-y-2 border-l border-border pl-3">
          {shown.map((comment) => (
            <li
              key={comment.id}
              className={cn('space-y-0.5', comment.id === PENDING && 'opacity-60')}
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-small font-semibold text-ink">
                  {comment.author === 'me' ? 'You' : 'Claude'}
                </span>
                <span className="tabular text-small text-ink-muted">
                  {comment.id === PENDING ? 'Sending…' : comment.createdAt.slice(0, 10)}
                </span>
                {comment.id !== PENDING && <DeleteComment id={comment.id} target={target} />}
              </div>
              <p className="whitespace-pre-wrap text-body text-ink">{comment.body}</p>
            </li>
          ))}

          {/* Where the answer is going to appear, while it is being written.
              This replaces the reply that used to be posted into the thread
              saying a session had been started -- that was a comment nobody
              wrote, left behind above the real answer forever. A line that is
              only there while you wait says the same thing and does not. */}
          {asking && (
            <li className="space-y-0.5" aria-live="polite">
              <span className="text-small font-semibold text-ink-muted">Claude</span>
              <p className="text-body text-ink-muted">Reading the row and replying…</p>
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
            name="body"
            rows={2}
            className="min-h-12"
            autoFocus
            placeholder={placeholder}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-1">
            <Button type="submit" size="sm">
              Save
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
