'use client';

import Link from 'next/link';
import { commentWhen, exactTime } from '@/lib/comments/when';
import type { MadeChange } from '@/lib/talk/changes';
import { useClockNow } from '@/lib/use-clock-now';
import { DashChangeRow, type ChangePresses } from './dash-changes';

/**
 * Every change the person confirmed through Dash, newest first, on the Ask
 * page (plan #1191, feature #1186). Each row is the card's own row: the
 * sentence linked to what was written, Done with an open link and Undo, or
 * Undone once taken back, and a refused undo's reason under it. The line
 * beneath the sentence says when, and links the question it was asked in.
 *
 * The presses are handed in, as for the cards, so the page brings the server
 * actions and the surface gallery brings fixtures.
 */
export function MadeChanges({
  changes,
  presses,
  today,
}: {
  changes: readonly MadeChange[];
  presses: ChangePresses;
  /** YYYY-MM-DD, so a due date this year leaves the year off. */
  today?: string;
}) {
  const now = useClockNow();
  if (changes.length === 0) return null;
  return (
    <ul aria-label="Changes Dash made" className="divide-y divide-border border-y border-border">
      {changes.map((change) => {
        const at = change.doneAt ?? change.createdAt;
        return (
          <li key={change.id} className="px-1 py-2.5">
            <DashChangeRow
              change={change}
              presses={presses}
              today={today}
              from={
                <>
                  <time dateTime={at} title={exactTime(at)} className="tabular">
                    {commentWhen(at, now)}
                  </time>
                  {', from '}
                  <Link
                    href={`/ask/${change.conversationId}`}
                    className="underline-offset-2 hover:text-ink hover:underline"
                  >
                    {change.question ?? 'a question'}
                  </Link>
                </>
              }
            />
          </li>
        );
      })}
    </ul>
  );
}
