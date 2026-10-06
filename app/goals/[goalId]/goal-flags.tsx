'use client';

import { useActionState } from 'react';
import { CircleHelp, Flag, ListChecks, Sparkles } from 'lucide-react';
import { Thread, type CommentStore } from '@/components/thread/thread';
import { threadRef } from '@/lib/thread/subjects';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { FieldError } from '@/components/ui/field';
import type { GoalFlag } from '@/lib/goals/flags';
import type { StatusRow } from '@/lib/goals/goal-status';
import type { StepNode } from '@/lib/goals/steps';
import {
  answerFlagAction,
  deleteFlagCommentAction,
  dismissFlagAction,
  type FlagActionState,
} from './flag-actions';
import { Question } from './step-parts';
import { LinkedText } from '@/components/ui/linked-text';

/**
 * Waiting on you, under the goal's status (plan #1078): what Dash flagged,
 * the questions to answer, the proposals to approve and the results to read,
 * one line each.
 *
 * A flag (plan #1015) is something a run found that is neither a step nor a
 * question, such as a moved due date. It opens to what was found, the thread
 * under it and a box to answer it. An answer starts a goal run with the
 * answer in its brief, and the run replies in the thread and closes the
 * flag; an open one can also be put aside unanswered. A question opens to
 * its options and answer box, the same as on its step's row. Proposals and
 * results are links to the rows that hold them, which are under Now.
 *
 * Your own ready steps are not listed: they are the open rows under Now, and
 * the status line counts them.
 */

const FLAG_STORE: CommentStore = {
  add: answerFlagAction,
  remove: deleteFlagCommentAction,
  // Never shown: the box always writes through `submit` below, which draws no
  // cost hint. An answer starts a routine run rather than a priced model call.
  paid: 'app/goals/[goalId]/comment-actions.ts#addGoalComment',
};

export function WaitingOnYou({
  rows,
  flags,
  questions,
}: {
  /** What `goalStatus` found waiting, most pressing first. Rows to do are left out here. */
  rows: StatusRow[];
  flags: GoalFlag[];
  /** Each question in `rows`, by id, for its answer box. */
  questions: Record<string, StepNode>;
}) {
  const flagOf = new Map(flags.map((flag) => [flag.id, flag]));
  const reads = rows.filter((row) => row.kind === 'read' && row.href.startsWith('#step-'));
  const shown = rows.filter((row) => row.kind !== 'do' && !reads.includes(row));
  // Flags already answered stay until Dash closes them, below the open ones.
  const answered = flags.filter((flag) => flag.status !== 'open');
  const count = shown.length + (reads.length > 0 ? 1 : 0) + answered.length;
  if (count === 0) return null;
  return (
    <section aria-labelledby="waiting-heading" className="space-y-2">
      <h2
        id="waiting-heading"
        className="flex items-baseline gap-2 px-1 text-ui font-semibold text-ink"
      >
        Waiting on you
        <span className="tabular text-small font-normal text-ink-muted">{count}</span>
      </h2>
      <Card padding="none">
        <ul className="divide-y divide-border">
          {shown.map((row) => {
            const flag = row.kind === 'flag' ? flagOf.get(row.id) : undefined;
            const question = row.kind === 'question' ? questions[row.id] : undefined;
            if (flag) return <FlagItem key={`flag-${flag.id}`} flag={flag} />;
            if (question) {
              return (
                <li key={`question-${row.id}`} className="card-pad-x row-pad">
                  <Disclosure
                    summaryClassName="items-baseline py-0"
                    bodyClassName="mt-1 -mx-1"
                    title={
                      <span className="inline-flex items-baseline gap-1.5 break-words">
                        <CircleHelp
                          className="size-3.5 shrink-0 translate-y-0.5 text-caution"
                          strokeWidth={1.75}
                          aria-hidden
                        />
                        {row.title}
                      </span>
                    }
                    meta="Answer"
                  >
                    <Question node={question} />
                  </Disclosure>
                </li>
              );
            }
            return <LinkItem key={`${row.kind}-${row.id}`} row={row} />;
          })}
          {reads.length > 0 && (
            <LinkItem
              row={{
                ...reads[0],
                label: 'Read',
                title:
                  reads.length === 1
                    ? reads[0].title
                    : `${reads.length} results Dash wrote, starting with ${reads[0].title}`,
              }}
            />
          )}
          {answered.map((flag) => (
            <FlagItem key={`flag-${flag.id}`} flag={flag} />
          ))}
        </ul>
      </Card>
    </section>
  );
}

const ICONS = { approve: Flag, read: Sparkles, question: CircleHelp } as const;

/** A row that is done elsewhere on the page: a link to where. */
function LinkItem({ row }: { row: StatusRow }) {
  const Icon =
    row.kind === 'approve' && row.href.startsWith('#step-')
      ? ListChecks
      : (ICONS[row.kind as keyof typeof ICONS] ?? Sparkles);
  return (
    <li>
      <a
        href={row.href}
        className="card-pad-x row-pad press flex items-start gap-2 text-ui hover:bg-sunken max-sm:min-h-11"
      >
        <Icon className="mt-0.5 size-3.5 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1 break-words text-ink">
          <span className="font-medium">{row.label}:</span> {row.title}
        </span>
      </a>
    </li>
  );
}

/** One flag, folded to its title, open to what was found and the answer box. */
function FlagItem({ flag }: { flag: GoalFlag }) {
  const [state, dismiss, dismissing] = useActionState(dismissFlagAction, {} as FlagActionState);
  const open = flag.status === 'open';
  return (
    <li id={`flag-${flag.id}`} className="card-pad-x row-pad scroll-mt-4">
      <Disclosure
        summaryClassName="items-baseline py-0"
        bodyClassName="mt-2 space-y-2"
        title={<span className="break-words">{flag.title}</span>}
        meta={open ? 'Dash flagged' : 'Answered'}
      >
        <div className="space-y-1">
          {flag.detail && (
            <p className="text-small break-words whitespace-pre-line text-ink-muted">
              <LinkedText text={flag.detail} />
            </p>
          )}
          {flag.ask && <p className="text-small break-words text-ink">{flag.ask}</p>}
          {!open && (
            <p className="text-small text-ink-muted">
              Answered. Dash closes it once it has acted on your answer.
            </p>
          )}
        </div>
        <Thread
          subject={threadRef('raise', flag.id)}
          turns={flag.thread}
          store={FLAG_STORE}
          submit={{ action: answerFlagAction, label: open ? 'Answer' : 'Say more' }}
          placeholder="Your answer. Dash acts on it and replies here."
        />
        {open && (
          <form action={dismiss} className="flex items-center gap-2">
            <input type="hidden" name="id" value={flag.id} />
            <Button type="submit" size="sm" variant="ghost" pending={dismissing}>
              Put aside
            </Button>
            <FieldError>{state.error}</FieldError>
          </form>
        )}
      </Disclosure>
    </li>
  );
}
