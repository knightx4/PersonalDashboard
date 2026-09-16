'use client';

import { useActionState, useState } from 'react';
import { ChevronRight, MessageCircleQuestion } from 'lucide-react';
import { decideRaise, dismissRaise, reopenRaise, type RaisedActionState } from './actions';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FieldError, Textarea } from '@/components/ui/field';
import { MODULES, type ModuleId } from '@/lib/modules';
import { needsFollowThrough, type RaisedQueue, type RaisedRow } from '@/lib/raised/load';
import { cardVariants } from '@/components/ui/card';
import { CommentCount } from '@/components/dev/comment-count';
import { CommentThread } from '@/components/dev/comment-thread';
import { StateLabel, type DevTone } from '@/components/dev/state-label';
import { Disclosure } from '@/components/ui/disclosure';
import { cn } from '@/lib/cn';
import { DEV_STATE_WORD, raisedState } from '@/lib/dev/words';
import { RAISED_STATUS_GLYPHS } from '@/lib/status-glyphs';

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
 * What a yes does, said before you give it. The #342 raise was answered yes,
 * closed, and produced nothing; reading the action first is what makes the
 * answer worth something. A raise filed before there was a column for it shows
 * nothing here.
 */
function Consequence({ said }: { said: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-micro font-semibold uppercase tracking-wide text-ink-muted">
        Answering yes
      </p>
      <p className="whitespace-pre-wrap text-body text-ink-muted">{said}</p>
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

/**
 * A closed raise, worded the way the other dev queues word it.
 *
 * "Answered" is this queue's own -- a raise closes on a reply, which is not the
 * same as the work being finished. A raise you turned down is the same fact as
 * a step dropped or a note declined, so it takes the shared word.
 *
 * Nothing on an open one: they are all under a heading that already says
 * "Waiting on you", and repeating it on every row would be the same fact twice.
 */
const RAISED_TONE: Record<RaisedRow['status'], DevTone> = {
  open: 'caution',
  answered: 'positive',
  dismissed: 'ghost',
};

function StatusLabel({ row }: { row: RaisedRow }) {
  const state = raisedState(row.status);
  if (row.status === 'open') return null;
  return (
    <StateLabel
      glyph={RAISED_STATUS_GLYPHS[row.status]}
      word={state ? DEV_STATE_WORD[state] : 'Answered'}
      tone={RAISED_TONE[row.status]}
    />
  );
}

/**
 * How a raise closes, and the only way it does.
 *
 * Yes runs the action it named and writes what happened into the thread, with
 * no second press: #359 settled that what you asked for is done and reported.
 * It is offered only on a raise that named one.
 *
 * The other way out is a reason, and it is offered on every raise, because a
 * raise closes on what it produced or on why nothing was needed. Answering in
 * free words used to close one too, which is how the #342 raise read as
 * handled for a day while what it described was still possible.
 *
 * "Yes, and…" opens a box for anything the declared action does not cover —
 * "take a look at the bug I just sent in too" — which is read as a comment on
 * the raise once the action has run. Closed until asked for (law 14): the
 * common answer is one press.
 */
function Decide({ row }: { row: RaisedRow }) {
  const [state, action, pending] = useActionState(decideRaise, {} as RaisedActionState);
  const [saying, setSaying] = useState<'nothing' | 'more' | 'why not'>('nothing');

  if (saying === 'why not') {
    return (
      <form action={action} className="w-full space-y-2">
        <input type="hidden" name="id" value={row.id} />
        <input type="hidden" name="answer" value="no" />
        <Textarea
          name="body"
          rows={2}
          autoFocus
          placeholder="What this came to, or why nothing was needed. It is what the raise closes on."
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" variant="secondary" pending={pending}>
            Close it
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setSaying('nothing')}>
            Cancel
          </Button>
          <FieldError>{state.error}</FieldError>
        </div>
      </form>
    );
  }

  return (
    <form action={action} className="w-full space-y-2">
      <input type="hidden" name="id" value={row.id} />
      <input type="hidden" name="answer" value="yes" />
      {saying === 'more' && (
        <Textarea
          name="body"
          rows={2}
          autoFocus
          placeholder="Anything the action above does not cover. It is read as a comment on this raise."
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {row.consequence && (
          <Button type="submit" size="sm" pending={pending}>
            Yes, do it
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant={row.consequence ? 'secondary' : 'primary'}
          onClick={() => setSaying('why not')}
        >
          Close with a reason
        </Button>
        {row.consequence && saying === 'nothing' && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setSaying('more')}>
            Yes, and…
          </Button>
        )}
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
        <CommentCount count={row.thread.length} />
      </div>

      <p className="text-body font-semibold text-ink">{row.title}</p>

      {/* The ask first and the story folded under it, because the reason to
          open this page is to find out what is wanted, not what happened. A
          raise filed before there was a column for the ask has only the story,
          so it keeps it open rather than hiding itself behind a fold. */}
      {row.ask ? (
        <>
          <Ask ask={row.ask} />
          {row.consequence && <Consequence said={row.consequence.said} />}
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

      {/* One thread, two ways into it. Answering closes the raise; a comment
          says something about it and leaves it open. */}
      <CommentThread
        target="raise"
        id={row.id}
        thread={row.thread}
        label="Add a comment"
        placeholder="Something about this raise that is not the answer to it. Tag @dash to ask; it stays open."
      />

      {/* Also on one that reached answered with nothing recorded: that raise is
          not finished, and the way to finish it is the same as any other. */}
      {(row.status === 'open' || needsFollowThrough(row)) && <Decide row={row} />}

      <div className="flex flex-wrap items-center gap-2">
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
 * Under them, the ones that were answered and produced nothing. They are not
 * waiting on you — you already answered — and they are not finished either, so
 * they are listed rather than filed with the history.
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

      {queue.unfinished.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-body font-semibold text-ink">
            Answered, nothing done{' '}
            <span className="font-normal text-ink-muted">({queue.unfinished.length})</span>
          </h2>
          <p className="text-small text-ink-muted">
            These closed without anything coming of them. Run what they asked for, or close one
            with the reason nothing was needed.
          </p>
          <ul className={cn(cardVariants(), 'divide-y divide-border')}>
            {queue.unfinished.map((row) => (
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
