import { MessageSquare } from 'lucide-react';

/**
 * How many comments a row is carrying, on the row.
 *
 * Which rows have been talked about is otherwise invisible until you open each
 * one, and on the plan that is a tree of a few hundred. A mark rather than a
 * column, for the reason the handed-over mark is one: it appears on the few
 * rows that have something, so it is worth reading where a column of zeros
 * would not be.
 *
 * Ink and a shape, no tint. Whether a row has been discussed is none of the
 * five things colour is allowed to claim.
 */
export function CommentCount({ count }: { count: number }) {
  if (count < 1) return null;

  const word = count === 1 ? 'comment' : 'comments';
  return (
    <span
      title={`${count} ${word}`}
      className="tabular inline-flex shrink-0 items-center gap-0.5 text-small text-ink-ghost"
    >
      <MessageSquare className="size-3" strokeWidth={2} aria-hidden />
      {count}
      <span className="sr-only">{word}</span>
    </span>
  );
}
