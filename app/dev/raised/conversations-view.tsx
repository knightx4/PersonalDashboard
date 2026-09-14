'use client';

import Link from 'next/link';
import { CommentThread } from '@/components/dev/comment-thread';
import { cardVariants } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { cn } from '@/lib/cn';
import type { CommentTarget } from '@/lib/comments/load';
import type { Conversation } from '@/lib/comments/recent';
import { commentWhen, exactTime } from '@/lib/comments/when';
import { useClockNow } from '@/lib/use-clock-now';

/**
 * Everything you and Dash have said to each other, in one list.
 *
 * A thread is otherwise only visible from the row it was written on, so an
 * answer written overnight is found by remembering which idea, step, raise or
 * note the question was asked on. Here they are one list, most recently active
 * first, and a reply goes into the same thread from here as from the row's own
 * page -- the box is the same `CommentThread`, given the target and row id it
 * takes everywhere else, so `@dash` behaves the same too.
 *
 * Under the raises rather than above them: a raise is waiting on you and a
 * conversation usually is not.
 */

/** Enough to cover a week of talking without turning the page into an archive. */
export const CONVERSATIONS_SHOWN = 20;

/** Where the row itself is, for the three that are not on this page. */
const ELSEWHERE: Partial<Record<CommentTarget, string>> = {
  idea: 'Open it on the ideas page',
  step: 'Open it on the plan',
  note: 'Open it on the bugs page',
};

function Line({ conversation }: { conversation: Conversation }) {
  const now = useClockNow();
  const who = conversation.lastAuthor === 'claude' ? 'Dash' : 'You';
  const elsewhere = ELSEWHERE[conversation.target];

  return (
    <li className="px-4 py-3">
      <Disclosure
        title={conversation.about}
        meta={
          <>
            {who}{' '}
            <time
              dateTime={conversation.lastAt}
              title={exactTime(conversation.lastAt)}
              className="tabular"
            >
              {commentWhen(conversation.lastAt, now)}
            </time>
          </>
        }
      >
        <div className="space-y-2">
          <CommentThread
            target={conversation.target}
            id={conversation.rowId}
            thread={conversation.thread}
            label="Reply"
            placeholder="A reply on this row. Tag @dash to ask for an answer."
          />
          {elsewhere && (
            <Link
              href={conversation.href}
              className="press inline-flex rounded-control text-small text-ink-ghost hover:text-ink"
            >
              {elsewhere}
            </Link>
          )}
        </div>
      </Disclosure>
    </li>
  );
}

export function ConversationsView({ conversations }: { conversations: Conversation[] }) {
  const shown = conversations.slice(0, CONVERSATIONS_SHOWN);

  return (
    <section className="space-y-2">
      <h2 className="text-body font-semibold text-ink">
        Conversations{' '}
        {conversations.length > 0 && (
          <span className="font-normal text-ink-muted">({conversations.length})</span>
        )}
      </h2>

      {shown.length === 0 ? (
        <p className="text-small text-ink-muted">
          Nothing said yet. Anything written on an idea, a plan step, a raise or a bug note shows
          up here.
        </p>
      ) : (
        <>
          <ul className={cn(cardVariants(), 'divide-y divide-border')}>
            {shown.map((conversation) => (
              <Line key={`${conversation.target}:${conversation.rowId}`} conversation={conversation} />
            ))}
          </ul>
          {conversations.length > shown.length && (
            <p className="text-small text-ink-muted">
              The {CONVERSATIONS_SHOWN} most recently active. The rest are on the rows they were
              written on.
            </p>
          )}
        </>
      )}
    </section>
  );
}
