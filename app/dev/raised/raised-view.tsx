'use client';

import { useActionState, useState } from 'react';
import { ChevronRight, MessageCircleQuestion } from 'lucide-react';
import { answerRaise, dismissRaise, reopenRaise, type RaisedActionState } from './actions';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FieldError, Textarea } from '@/components/ui/field';
import { MODULES, type ModuleId } from '@/lib/modules';
import type { RaisedComment, RaisedQueue, RaisedRow } from '@/lib/raised/load';
import { cardVariants } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { cn } from '@/lib/cn';

const MODULE_LABEL: Record<ModuleId, string> = Object.fromEntries(
  MODULES.map((module) => [module.id, module.label]),
) as Record<ModuleId, string>;

/** "Everything" rather than an empty label, the same as the ideas list. */
function scopeLabel(module: ModuleId | null): string {
  return module ? MODULE_LABEL[module] : 'Everything';
}

/**
 * What the raise wants back from you, said apart from the story that produced
 * it. The label is there so a row reads as a request rather than as a report:
 * a page of paragraphs is a page nobody can clear.
 */
function Ask({ ask }: { ask: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-micro font-semibold uppercase tracking-wide text-ink-muted">
        Needs from you
      </p>
      <p className="whitespace-pre-wrap text-body text-ink">{ask}</p>
    </div>
  );
}

/**
 * The first sentence of the detail, for the closed line of the fold — law 10
 * wants the summary to say whether opening it is worth it.
 */
function lead(detail: string): string {
  const flat = detail.replace(/\s+/g, ' ').trim();
  const end = flat.search(/[.?!](\s|$)/);
  const first = end === -1 ? flat : flat.slice(0, end + 1);
  return first.length > 90 ? `${first.slice(0, 89).trimEnd()}…` : first;
}

function StatusLabel({ row }: { row: RaisedRow }) {
  if (row.status === 'open') return null;
  return (
    <span className="text-small text-ink-muted">
      {row.status === 'answered' ? 'Answered' : 'Dismissed'}
    </span>
  );
}

/**
 * The thread, oldest first. Your answers and the session's replies to them,
 * told apart by who wrote each one rather than by where it sits.
 */
function Thread({ comments }: { comments: RaisedComment[] }) {
  if (comments.length === 0) return null;

  return (
    <ul className="space-y-2 border-l border-border pl-3">
      {comments.map((comment) => (
        <li key={comment.id} className="space-y-0.5">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-small font-semibold text-ink">
              {comment.author === 'me' ? 'You' : 'Claude'}
            </span>
            <span className="tabular text-small text-ink-muted">
              {comment.createdAt.slice(0, 10)}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-body text-ink">{comment.body}</p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Writing an answer. Closed until asked for (law 14): the reason to open this
 * page is to read what is waiting, and a box under every raise would be the
 * page.
 */
function AnswerRaise({ row }: { row: RaisedRow }) {
  const [state, action, pending] = useActionState(answerRaise, {} as RaisedActionState);
  const [writing, setWriting] = useState(false);

  // Close once it has saved, the same as the ideas composer: the answer
  // appearing in the thread is the confirmation.
  const [seen, setSeen] = useState<string | undefined>(undefined);
  if (state.message !== seen) {
    setSeen(state.message);
    if (state.message && !state.error) setWriting(false);
  }

  if (!writing) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setWriting(true)}>
        {row.comments.length === 0 ? 'Answer' : 'Reply'}
      </Button>
    );
  }

  return (
    <form action={action} className="w-full space-y-2">
      <input type="hidden" name="id" value={row.id} />
      <Textarea
        name="body"
        rows={3}
        autoFocus
        placeholder="What you want done about it. The next session reads this before it starts."
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" pending={pending}>
          {row.comments.length === 0 ? 'Answer' : 'Reply'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setWriting(false)}>
          Cancel
        </Button>
        <FieldError>{state.error}</FieldError>
      </div>
    </form>
  );
}

function RaiseCard({ row }: { row: RaisedRow }) {
  const [dismissState, dismissAction, dismissPending] = useActionState(
    dismissRaise,
    {} as RaisedActionState,
  );
  const [reopenState, reopenAction, reopenPending] = useActionState(
    reopenRaise,
    {} as RaisedActionState,
  );

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-accent-tint px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-accent">
          {scopeLabel(row.module)}
        </span>
        <span className="tabular text-small text-ink-muted">{row.createdAt.slice(0, 10)}</span>
        <StatusLabel row={row} />
      </div>

      <p className="text-body font-semibold text-ink">{row.title}</p>

      {/* The ask first and the story folded under it, because the reason to
          open this page is to find out what is wanted, not what happened. A
          raise filed before there was a column for the ask has only the story,
          so it keeps it open rather than hiding itself behind a fold. */}
      {row.ask ? (
        <>
          <Ask ask={row.ask} />
          {row.detail && (
            <Disclosure title="Why it came up" meta={lead(row.detail)}>
              <p className="whitespace-pre-wrap text-body text-ink">{row.detail}</p>
            </Disclosure>
          )}
        </>
      ) : (
        row.detail && <p className="whitespace-pre-wrap text-body text-ink">{row.detail}</p>
      )}

      {/* Which run raised it. Without this a raise is a voice from nowhere, and
          the first thing you want to know is what it was doing at the time. */}
      {row.source && <p className="text-small text-ink-muted">Raised by {row.source}</p>}

      <Thread comments={row.comments} />

      <div className="flex flex-wrap items-center gap-2">
        {row.status !== 'dismissed' && <AnswerRaise row={row} />}
        {row.status === 'open' ? (
          <form action={dismissAction}>
            <input type="hidden" name="id" value={row.id} />
            <Button type="submit" size="sm" variant="ghost" pending={dismissPending}>
              Dismiss
            </Button>
          </form>
        ) : (
          <form action={reopenAction}>
            <input type="hidden" name="id" value={row.id} />
            <Button type="submit" size="sm" variant="ghost" pending={reopenPending}>
              Reopen
            </Button>
          </form>
        )}
        <FieldError>{dismissState.error ?? reopenState.error}</FieldError>
      </div>
    </li>
  );
}

/**
 * What sessions have asked you, open ones first.
 *
 * Answered and dismissed rows go under a disclosure rather than in the list:
 * the reason to open this page is what is still waiting, and a closed raise is
 * kept so that a session can read the answer back rather than so you can read
 * it again.
 */
export function RaisedView({ queue }: { queue: RaisedQueue }) {
  return (
    <div className="space-y-6">
      {queue.open.length === 0 && (
        <EmptyState
          icon={MessageCircleQuestion}
          title="Nothing waiting on you"
          description="A session writes here when it needs something you have to decide — a risk it found while building something else, or a question of taste it will not answer on its own."
        />
      )}

      {queue.open.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-body font-semibold text-ink">
            Waiting on you <span className="font-normal text-ink-muted">({queue.open.length})</span>
          </h2>
          <ul className={cn(cardVariants(), 'divide-y divide-border')}>
            {queue.open.map((row) => (
              <RaiseCard key={row.id} row={row} />
            ))}
          </ul>
        </section>
      )}

      {queue.closed.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-body font-semibold text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRight
              className="size-4 shrink-0 text-ink-ghost transition-transform duration-150 group-open:rotate-90"
              strokeWidth={1.75}
              aria-hidden
            />
            Closed <span className="font-normal text-ink-muted">({queue.closed.length})</span>
          </summary>
          <ul className={cn(cardVariants(), 'mt-2 divide-y divide-border')}>
            {queue.closed.map((row) => (
              <RaiseCard key={row.id} row={row} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
