import type { NextRow } from '@/lib/learn/next/rank';
import { pushAside } from './actions';

/**
 * Putting a row off without doing anything about it.
 *
 * Sits with the row's own action rather than at the end of the list, because
 * it is a thing you do to one row. What it records is in `lib/learn/next/record.ts`
 * and what it does to the order is in `lib/learn/next/rank.ts`.
 */
export function NotNow({ row }: { row: NextRow }) {
  return (
    <form action={pushAside}>
      <input type="hidden" name="kind" value={row.kind} />
      {row.kind === 'reading' ? (
        <input type="hidden" name="readingId" value={row.readingId} />
      ) : (
        <input type="hidden" name="conceptId" value={row.concept.id} />
      )}
      <button
        type="submit"
        className="text-ui text-ink-muted underline-offset-2 hover:text-accent hover:underline"
      >
        Not now
      </button>
    </form>
  );
}
