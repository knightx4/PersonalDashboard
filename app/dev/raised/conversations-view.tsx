'use client';

import { useState } from 'react';
import Link from 'next/link';
import { markConversationRead } from './actions';
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
 *
 * A conversation Dash has written in since you last opened it carries a mark.
 * Opening it is what clears it -- #432 -- so the line drops its own mark on the
 * press and the write goes off behind it. Nothing is redrawn: a revalidate here
 * would fold the conversation shut as you opened it.
 */

/** Enough to cover a week of talking without turning the page into an archive. */
export const CONVERSATIONS_SHOWN = 20;

/**
 * The start of the last message, for the closed line — law 10 wants the
 * collapsed row to say whether opening it is worth it. Cut to one line: a
 * comment is a paragraph and this is a list.
 */
function lead(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? `${flat.slice(0, 59).trimEnd()}…` : flat;
}

/** Where the row itself is, for the three that are not on this page. */
const ELSEWHERE: Partial<Record<CommentTarget, string>> = {
  idea: 'Open it on the ideas page',
  step: 'Open it on the plan',
  note: 'Open it on the bugs page',
};

function Line({ conversation }: { conversation: Conversation }) {
  const now = useClockNow();
  const [opened, setOpened] = useState(false);
  const who = conversation.lastAuthor === 'claude' ? 'Dash' : 'You';
  const elsewhere = ELSEWHERE[conversation.target];
  const unread = conversation.unread && !opened;
  const last = conversation.thread[conversation.thread.length - 1];

  return (
    <li className="px-4 py-3">
      <Disclosure
        onToggle={(open) => {
          if (!open) return;
          setOpened(true);
          void markConversationRead(conversation.target, conversation.rowId);
        }}
        title={
          <span className="inline-flex items-baseline gap-1.5">
            {/* Ink and a shape, no tint: whether you have read something is
                none of the five things colour is allowed to claim. */}
            {unread && (
              <span
                title="Dash has written here since you last opened it"
                className="inline-flex size-1.5 shrink-0 translate-y-[-1px] rounded-full bg-ink"
              >
                <span className="sr-only">Unread</span>
              </span>
            )}
            {conversation.about}
          </span>
        }
        meta={
          <span className="inline-flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0">
              {who}{' '}
              <time
                dateTime={conversation.lastAt}
                title={exactTime(conversation.lastAt)}
                className="tabular"
              >
                {commentWhen(conversation.lastAt, now)}
              </time>
            </span>
            {/* What was last said, so the line says whether the answer is the
                one you were waiting for. Off at phone width, where the two
                things above it are already the whole row. */}
            {last && (
              <span className="hidden max-w-64 truncate text-ink-ghost sm:inline-block">
                {lead(last.body)}
              </span>
            )}
          </span>
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
