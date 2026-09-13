'use client';

import { useActionState, useState } from 'react';
import { X } from 'lucide-react';
import { addComment, deleteComment, type CommentActionState } from '@/app/dev/comment-actions';
import { Button } from '@/components/ui/button';
import { FieldError, Textarea } from '@/components/ui/field';
import type { CommentTarget, DevComment } from '@/lib/comments/load';

/**
 * The thread on one row of the dev pages, and the box for adding to it.
 *
 * The same component on an idea, a plan step and a raise, because the thing
 * being written is the same thing in all three places: something you want
 * attached to that row rather than to a transcript. It is a note until it asks
 * for a reply, which is what makes it worth having on rows nobody is waiting
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

/**
 * Writing one. Closed until asked for (law 14): most rows have nothing to say
 * about them, and a box under every one of them would be the page.
 */
function AddComment({
  target,
  id,
  label,
  placeholder,
}: {
  target: CommentTarget;
  id: string;
  label: string;
  placeholder: string;
}) {
  const [state, action, pending] = useActionState(addComment, {} as CommentActionState);
  const [writing, setWriting] = useState(false);

  // Close once it has saved: the comment appearing in the thread is the
  // confirmation. Adjusted during render rather than in an effect, the same
  // way the ideas composer does it.
  const [seen, setSeen] = useState<string | undefined>(undefined);
  if (state.message !== seen) {
    setSeen(state.message);
    if (state.message && !state.error) setWriting(false);
  }

  if (!writing) {
    return (
      <button
        type="button"
        onClick={() => setWriting(true)}
        className="press -ml-1.5 inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-ui text-ink-ghost hover:bg-sunken hover:text-ink-muted"
      >
        <span aria-hidden>+</span>
        {label}
      </button>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="target" value={target} />
      <input type="hidden" name="id" value={id} />
      <Textarea name="body" rows={2} className="min-h-12" autoFocus placeholder={placeholder} />
      <div className="flex flex-wrap items-center gap-1">
        <Button type="submit" size="sm" pending={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setWriting(false)}>
          Cancel
        </Button>
        <FieldError>{state.error}</FieldError>
      </div>
    </form>
  );
}

export function CommentThread({
  target,
  id,
  thread,
  label,
  placeholder = 'A note on this row. It is yours — nothing reads it and nothing happens.',
}: {
  target: CommentTarget;
  /** The row being commented on, not the comment. */
  id: string;
  thread: readonly DevComment[];
  /** What the trigger says when the thread is empty. */
  label?: string;
  placeholder?: string;
}) {
  const trigger = label ?? (thread.length === 0 ? 'Add a comment' : 'Add another');

  return (
    <div className="space-y-2">
      {thread.length > 0 && (
        <ul className="space-y-2 border-l border-border pl-3">
          {thread.map((comment) => (
            <li key={comment.id} className="space-y-0.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-small font-semibold text-ink">
                  {comment.author === 'me' ? 'You' : 'Claude'}
                </span>
                <span className="tabular text-small text-ink-muted">
                  {comment.createdAt.slice(0, 10)}
                </span>
                <DeleteComment id={comment.id} target={target} />
              </div>
              <p className="whitespace-pre-wrap text-body text-ink">{comment.body}</p>
            </li>
          ))}
        </ul>
      )}

      <AddComment target={target} id={id} label={trigger} placeholder={placeholder} />
    </div>
  );
}
