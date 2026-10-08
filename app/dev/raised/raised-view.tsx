'use client';

import { useActionState, useState } from 'react';
import { MessageCircleQuestion } from 'lucide-react';
import {
  closeRaise,
  decideRaise,
  dismissRaise,
  reopenRaise,
  type RaisedActionState,
} from './actions';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FieldError, Textarea } from '@/components/ui/field';
import { MODULES, type ModuleId } from '@/lib/modules';
import { needsFollowThrough, type RaisedQueue, type RaisedRow } from '@/lib/raised/load';
import type { WaitingGroup } from '@/lib/plan/waiting';
import { ApproveAll, WaitingCard } from './waiting-view';
import { SpecChangeCard } from '@/app/dev/specs/spec-change-card';
import { cardVariants } from '@/components/ui/card';
import { CommentCount } from '@/components/dev/comment-count';
import { Thread } from '@/components/thread/thread';
import { threadRef } from '@/lib/thread/subjects';
import { RefText } from '@/components/dev/ref-text';
import type { PlanRefTitles } from '@/lib/comments/refs';
import { StateLabel, type DevTone } from '@/components/dev/state-label';
import { Disclosure, Group, SectionFold } from '@/components/ui/disclosure';
import { cn } from '@/lib/cn';
import { raiseAnchor } from '@/lib/search/sources/dev-map';
import { raisedHealth, type RaisedHealth } from '@/lib/dev/health';
import { RAISED_HEALTH_WORD } from '@/lib/dev/words';
import { RAISED_HEALTH_GLYPHS } from '@/lib/status-glyphs';
import { PaidHint } from '@/components/ui/paid-hint';

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
function Ask({ ask, titles }: { ask: string; titles?: PlanRefTitles }) {
  return (
    <div className="space-y-0.5">
      <p className="text-micro font-semibold uppercase tracking-wide text-ink-muted">
        Needs from you
      </p>
      <p className="whitespace-pre-wrap text-body text-ink">
        <RefText text={ask} titles={titles} />
      </p>
    </div>
  );
}

/**
 * What a yes does, said before you give it. The #342 raise was answered yes,
 * closed, and produced nothing; reading the action first is what makes the
 * answer worth something. A raise filed before there was a column for it shows
 * nothing here.
 */
function Consequence({ said, titles }: { said: string; titles?: PlanRefTitles }) {
  return (
    <div className="space-y-0.5">
      <p className="text-micro font-semibold uppercase tracking-wide text-ink-muted">
        Answering yes
      </p>
      <p className="whitespace-pre-wrap text-body text-ink-muted">
        <RefText text={said} titles={titles} />
      </p>
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
 * A raise that is no longer open, worded the way the other dev queues word it.
 *
 * "Answered" is this queue's own -- a raise closes on a reply, which is not the
 * same as the work being finished. A raise you turned down is the same fact as
 * a step dropped or a note declined, so it takes the shared word, and so does
 * one you are finished with.
 *
 * `closed` is quiet rather than positive: it is the row you have read and put
 * away, and the green is for the state that still wants looking at.
 *
 * Nothing on an open one: they are all under a heading that already says
 * "Waiting on you", and repeating it on every row would be the same fact twice.
 */
const HEALTH_TONE: Record<RaisedHealth, DevTone> = {
  waiting: 'caution',
  unfinished: 'caution',
  answered: 'positive',
  closed: 'quiet',
  dropped: 'ghost',
};

function StatusLabel({ row }: { row: RaisedRow }) {
  if (row.status === 'open') return null;
  const health = raisedHealth(row);
  return (
    <StateLabel
      glyph={RAISED_HEALTH_GLYPHS[health]}
      word={RAISED_HEALTH_WORD[health]}
      tone={HEALTH_TONE[health]}
      title={
        health === 'unfinished'
          ? 'Answered, and nothing was recorded as coming of it. Run what it asked for, or close it with the reason nothing was needed.'
          : undefined
      }
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
        {/* ui-ok: composer-always-open -- this whole branch renders only after
         * "No, and here is why" is pressed. The guard is an early return on
         * `saying`, which the gate reads only in its `if (!open)` shape. */}
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
        // ui-ok: composer-always-open -- opened by "Yes, and…" and closed
        // otherwise. The gate reads `{flag && (` and not a comparison.
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
        {/* What is written beyond the yes is read by Dash as a comment. */}
        {row.consequence && saying === 'more' && (
          <PaidHint action="app/dev/raised/actions.ts#decideRaise" what="Cost of Dash's reply" />
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

function RaiseCard({ row, titles }: { row: RaisedRow; titles?: PlanRefTitles }) {
  const [dismissState, dismissAction, dismissPending] = useActionState(
    dismissRaise,
    {} as RaisedActionState,
  );
  const [closeState, closeAction, closePending] = useActionState(
    closeRaise,
    {} as RaisedActionState,
  );
  const [reopenState, reopenAction, reopenPending] = useActionState(
    reopenRaise,
    {} as RaisedActionState,
  );

  // Answered and something came of it, so the only thing left is you saying
  // you have read it. An answered raise with nothing recorded is not this: it
  // is offered the Decide form above instead, because it still owes an outcome.
  const canClose = row.status === 'answered' && Boolean(row.outcome);

  return (
    // The anchor a search hit on this raise lands on (plan #1154).
    <li id={raiseAnchor(row.id)} className="flex scroll-mt-bar flex-col gap-2 px-4 py-3">
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
          <Ask ask={row.ask} titles={titles} />
          {row.consequence && <Consequence said={row.consequence.said} titles={titles} />}
          {row.detail && (
            <Disclosure title="Why it came up" meta={lead(row.detail)}>
              <p className="whitespace-pre-wrap text-body text-ink">
                <RefText text={row.detail} titles={titles} />
              </p>
            </Disclosure>
          )}
        </>
      ) : (
        row.detail && (
          <p className="whitespace-pre-wrap text-body text-ink">
            <RefText text={row.detail} titles={titles} />
          </p>
        )
      )}

      {/* Which run raised it. Without this a raise is a voice from nowhere, and
          the first thing you want to know is what it was doing at the time. */}
      {row.source && <p className="text-small text-ink-muted">Raised by {row.source}</p>}

      {/* One thread, two ways into it. The buttons answer the ask it named;
          what you write here is an answer in your own words, and it starts a
          session that acts on it and replies under you. */}
      <Thread
        subject={threadRef('raise', row.id)}
        turns={row.thread}
        label="Answer in your own words"
        placeholder="What you want done about this. A session reads it, does it, and replies here."
        titles={titles}
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
          <>
            {canClose && (
              <form action={closeAction}>
                <input type="hidden" name="id" value={row.id} />
                <Button type="submit" size="sm" variant="secondary" pending={closePending}>
                  Close it
                </Button>
              </form>
            )}
            <form action={reopenAction}>
              <input type="hidden" name="id" value={row.id} />
              <Button type="submit" size="sm" variant="ghost" pending={reopenPending}>
                Reopen
              </Button>
            </form>
          </>
        )}
        <FieldError>{dismissState.error ?? closeState.error ?? reopenState.error}</FieldError>
      </div>
    </li>
  );
}

/** What finishes each group, said under its count in the overview. */
const GROUP_HINT: Record<WaitingGroup['key'], string> = {
  actions: 'To go and do',
  questions: 'Need your answer',
  approve: 'Need your yes',
};

/** The anchor each section of the inbox is reached by from the overview. */
function sectionAnchor(key: string): string {
  return `inbox-${key}`;
}

type OverviewCell = { key: string; title: string; count: number; hint: string };

/**
 * The top of the inbox: how many of each kind there are, each a link to its
 * section. A long inbox otherwise has to be scrolled to find out whether the
 * questions are two or twenty, and that decides whether you start with them.
 */
function Overview({ cells }: { cells: readonly OverviewCell[] }) {
  return (
    <nav
      aria-label="Inbox sections"
      className={cn(cardVariants({ padding: 'dense' }), 'grid grid-cols-2 gap-1 sm:grid-cols-4')}
    >
      {cells.map((cell) => (
        <a
          key={cell.key}
          href={`#${sectionAnchor(cell.key)}`}
          className="press flex flex-col gap-0.5 rounded-control p-2 hover:bg-sunken"
        >
          <span className="tabular text-title font-semibold text-ink">{cell.count}</span>
          <span className="text-small font-semibold text-ink">{cell.title}</span>
          <span className="text-micro text-ink-muted">{cell.hint}</span>
        </a>
      ))}
    </nav>
  );
}

/**
 * Everything waiting on you, the Inbox tab in Dev.
 *
 * It was the middle of Home, between the morning summary and the
 * conversations, and on a busy day the summary pushed it below the fold. It is
 * its own tab now so that the list of things to clear is the whole page and
 * the badge on the tab is the length of that list.
 *
 * The overview first, then one section per kind of work, then the raises that
 * were answered and produced nothing. They are not waiting on you, since you
 * already answered, and they are not finished either, so they are listed
 * rather than filed with the history.
 *
 * Answered and dismissed rows go under a shut fold at the bottom: a closed
 * raise is kept so that a session can read the answer back rather than so you
 * can read it again.
 */
export function RaisedView({
  queue,
  groups,
  titles,
}: {
  queue: RaisedQueue;
  /**
   * Everything waiting on you, already sorted into your actions, questions for
   * you and to approve. All three arrive whether or not they hold anything,
   * and an empty one is not drawn: a heading over nothing is a heading that
   * has to be read before it can be skipped.
   */
  groups: readonly WaitingGroup[];
  /** What each step number in a raise is called, for the hover text. */
  titles?: PlanRefTitles;
}) {
  const filled = groups.filter((group) => group.entries.length > 0);
  const cells: OverviewCell[] = filled.map((group) => ({
    key: group.key,
    title: group.title,
    count: group.entries.length,
    hint: GROUP_HINT[group.key],
  }));
  if (queue.unfinished.length > 0) {
    cells.push({
      key: 'unfinished',
      title: 'Answered, nothing done',
      count: queue.unfinished.length,
      hint: 'Run it or close it',
    });
  }

  return (
    <div className="space-y-6">
      {cells.length === 0 ? (
        <EmptyState
          icon={MessageCircleQuestion}
          title="Nothing waiting on you"
          description="A session writes here when it needs something you have to decide: a risk it found while building something else, or a question of taste it will not answer on its own."
        />
      ) : (
        <Overview cells={cells} />
      )}

      {/* One section per kind rather than one list sorted by how pressing each
          row is. That list asked you to work out, row by row, whether the
          thing in front of you was a job, a question or a yes, and the three
          want different amounts of you. */}
      {filled.map((group) => (
        <div key={group.key} id={sectionAnchor(group.key)} className="scroll-mt-bar">
          <Group
            fold
            title={
              <>
                {group.title}
                <span className="tabular ml-2 font-normal text-ink-muted">{group.entries.length}</span>
              </>
            }
            /* Opposite the heading rather than on a row of its own: it acts on
               the whole group, and a button inside the list would read as
               belonging to whichever row it landed next to. Only this group
               has one; the other two are finished a row at a time, in words. */
            action={group.key === 'approve' ? <ApproveAll entries={group.entries} /> : undefined}
          >
            <ul className={cn(cardVariants(), 'divide-y divide-border')}>
              {/* A plan row and a raise sit in the same group when the same
                  thing finishes them, so which card is drawn comes off the
                  entry rather than off which list it arrived in. */}
              {group.entries.map((entry) =>
                entry.kind === 'plan' ? (
                  <WaitingCard key={entry.id} row={entry.row} titles={titles} />
                ) : entry.kind === 'spec' ? (
                  <SpecChangeCard
                    key={entry.id}
                    change={entry.spec.change}
                    specTitle={entry.spec.specTitle}
                    foldDiff
                  />
                ) : (
                  <RaiseCard key={entry.id} row={entry.raise} titles={titles} />
                ),
              )}
            </ul>
          </Group>
        </div>
      ))}

      {queue.unfinished.length > 0 && (
        <div id={sectionAnchor('unfinished')} className="scroll-mt-bar">
          <SectionFold title="Answered, nothing done" count={queue.unfinished.length}>
            <p className="text-small text-ink-muted">
              These closed without anything coming of them. Run what they asked for, or close one
              with the reason nothing was needed.
            </p>
            <ul className={cn(cardVariants(), 'divide-y divide-border')}>
              {queue.unfinished.map((row) => (
                <RaiseCard key={row.id} row={row} titles={titles} />
              ))}
            </ul>
          </SectionFold>
        </div>
      )}

      {/* Shut, where the others open: this one is history rather than work. */}
      {queue.closed.length > 0 && (
        <SectionFold title="Closed" count={queue.closed.length} defaultOpen={false}>
          <ul className={cn(cardVariants(), 'divide-y divide-border')}>
            {queue.closed.map((row) => (
              <RaiseCard key={row.id} row={row} titles={titles} />
            ))}
          </ul>
        </SectionFold>
      )}
    </div>
  );
}
