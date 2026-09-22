'use client';

/**
 * What a row says about the run behind it: how long it has been going, what it
 * pushed, what CI made of the commit, and what the session did.
 *
 * Split out of plan-view.tsx, which had grown to about a hundred and forty
 * thousand characters -- roughly thirty-six thousand tokens, paid by every
 * session that opened it to change anything on the page, and carried for the
 * rest of that session. These components are read together and touched
 * together, and none of them is used anywhere else.
 */
import { useMemo } from 'react';
import { CircleAlert } from 'lucide-react';
import { useClockNow } from '@/lib/use-clock-now';
import { elapsedSince } from '@/lib/plan/elapsed';
import { type ClaimLiveness } from '@/lib/plan/liveness';
import { lastRunLine, type LastRun } from '@/lib/plan/run-end';
import {
  closedLine,
  nothingToShowLine,
  pushLine,
  raisedLine,
  refusalLine,
  runStartedLine,
  runWork,
  workIsEmpty,
  type RunRaise,
} from '@/lib/plan/work';
import { checkLine, checkWord, type CommitCheck } from '@/lib/plan/checks';
import type { PlanNode } from '@/lib/plan/tree';
import { subtreeOf, type PlanCatalogEntry } from './plan-catalog';
import { cn } from '@/lib/cn';

/**
 * One of the row's quick actions.
 *
 * An icon on the row rather than a button behind the fold: sending a step to
 * Claude, handing it over and editing it are the three things done to a step
 * without needing to read it first, and reaching them through the step's own
 * detail made every one of them two clicks and a scroll.
 */
export function RowIconButton({
  label,
  type = 'button',
  pending = false,
  onClick,
  children,
}: {
  label: string;
  type?: 'button' | 'submit';
  pending?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type={type}
      title={label}
      onClick={onClick}
      disabled={pending}
      className="press flex size-7 items-center justify-center rounded-lg text-ink-muted transition-colors duration-150 hover:bg-sunken hover:text-ink disabled:opacity-50"
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}

export function when(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}

/** The clock on a step that is underway. */
export function Elapsed({ startedAt }: { startedAt: string }) {
  const now = useClockNow();

  return <>{now === 0 ? '…' : elapsedSince(startedAt, now)}</>;
}

/**
 * The same fact in the opened row's meta line, where there is room for the
 * word. "Running 7h" and "stopped after 7h, nothing on it" are two of the
 * things a step underway can mean, and the line said only the first.
 *
 * The reading comes from `claimLiveness` through the row rather than from the
 * clock here, so this line and the health column beside it cannot differ about
 * the same claim.
 */
export function RunningFor({ startedAt, claim }: { startedAt: string; claim: ClaimLiveness | undefined }) {
  if (claim === 'abandoned') {
    return (
      <span className="text-caution">
        {' · stopped after '}
        <Elapsed startedAt={startedAt} />, nothing on it
      </span>
    );
  }

  if (claim === 'quiet') {
    return (
      <span className="text-caution">
        {' · running '}
        <Elapsed startedAt={startedAt} />, nothing pushed lately
      </span>
    );
  }

  return (
    <>
      {' · running '}
      <Elapsed startedAt={startedAt} />
    </>
  );
}

/**
 * What CI said about the commit this step shipped in.
 *
 * Read off the merge that carried the step onto main rather than off the sha
 * the step records, which is nearly always a branch commit nothing ever
 * checked -- #555. A commit whose checks passed carries no mark: it is the
 * ordinary case, and the step's own Done is already saying it. Everything else
 * gets one, a commit nobody has looked up yet included, because a step with no
 * answer sitting unmarked among steps that passed reads as a step that passed.
 */
export function CheckMark({ check }: { check: CommitCheck | undefined }) {
  const word = checkWord(check);
  if (!word) return null;

  const failed = check?.conclusion === 'failed';
  // A step closed against a commit main does not carry is at least as wrong as
  // one closed against a red commit -- the work is nowhere, not merely broken
  // -- so it is marked as loudly rather than sitting grey among the steps
  // nobody has looked up yet. #637.
  const alarming = failed || check?.conclusion === 'unmerged';
  const merge = check?.mergeSha ? check.mergeSha.slice(0, 7) : null;
  const title = failed
    ? `The checks failed on ${merge}, the merge that put this on main.`
    : merge
      ? `${checkLine(check)} on ${merge}, the merge that put this on main.`
      : `${checkLine(check)}.`;

  return (
    <span
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 text-small font-semibold',
        alarming ? 'bg-caution-tint text-caution' : 'font-normal text-ink-ghost',
      )}
    >
      {alarming && <CircleAlert className="size-3" strokeWidth={2} aria-hidden />}
      {word}
    </span>
  );
}

/**
 * What the last routine run against this step did.
 *
 * The claim beside it is what the step says about itself; this is what the run
 * says. They disagree often enough to be worth both: a step still reading
 * in_progress whose run stopped four hours ago is the case this line exists
 * for, and before `plan_runs` was written back nothing on the page could tell
 * you which of the two had happened.
 */
export function LastRunLine({ run }: { run: LastRun }) {
  const now = useClockNow();

  return (
    <span className={run.status === 'failed' ? 'text-caution' : undefined}>
      {lastRunLine(run, now)}
    </span>
  );
}

/**
 * What the run behind this step has actually done.
 *
 * The row above says "In progress" and a number of minutes, which is the same
 * sentence whether the session has closed two steps or has been sitting on a
 * failed build since it started. So the step you have opened on purpose gets
 * the evidence: which press started the run and when, what it last pushed,
 * which steps closed after it was fired, and what it raised.
 *
 * A run with none of that says which kind of none it is, because they are
 * different things to do about it -- see `nothingToShowLine`. Nothing here asks
 * GitHub: the push is the reading stored on the run row, so an opened step
 * costs no request.
 *
 * The rules are in `lib/plan/work.ts` so the terminal tool and a session's
 * brief can say the same thing from the same rows.
 */
export function RunWork({
  run,
  node,
  catalog,
  raises,
}: {
  run: LastRun;
  node: PlanNode;
  catalog: readonly PlanCatalogEntry[];
  raises: readonly RunRaise[];
}) {
  const now = useClockNow();
  // The row and everything under it: a step run closes its own sub-steps and a
  // feature batch closes the steps under the feature it was sent at. From the
  // catalog rather than from `node.children`, because the view has already
  // taken the closed steps out of the tree the row is drawn from.
  const work = useMemo(() => {
    const subtree = subtreeOf(catalog, node.id);
    return runWork({ run, steps: catalog.filter((entry) => subtree.has(entry.id)), raises });
  }, [run, node.id, catalog, raises]);
  const empty = workIsEmpty(work);
  const closed = closedLine(work);
  const raised = raisedLine(work);
  const refused = refusalLine(work);

  return (
    <div>
      <p className="text-small font-semibold uppercase tracking-wide text-ink-muted">Its run</p>
      <p className="text-ui text-ink">{runStartedLine(work, now)}</p>
      {work.push && <p className="text-ui text-ink-muted">{pushLine(work.push, now)}</p>}
      {closed && <p className="text-ui text-ink-muted">{closed}</p>}
      {raised && <p className="text-ui text-ink-muted">{raised}</p>}
      {empty && <p className="text-ui text-ink-muted">{nothingToShowLine(work, now)}</p>}
      {/* After the rest, because what the run did is what was asked for and
          this is why one of the four lines is missing. Caution rather than
          muted: nothing on this row can be read properly until the key is
          fixed, and the sentence says how. */}
      {refused && <p className="text-ui text-caution">{refused}</p>}
    </div>
  );
}

/**
 * The badge on a step that is underway, and the one place the page admits a
 * claim can go stale.
 *
 * Nothing releases a claim when the session holding it dies, so an abandoned
 * step sat here pulsing at the same accent as one being worked this minute --
 * the state was seven hours old and the badge said "live". The pill now says
 * what the run says: the dot pulses while the session is pushing, stops and
 * turns caution once it has gone quiet, and the pill says the run stopped once
 * it is past the ended mark. The row is still `in_progress`, because only you
 * can say whether the work happened, but the page no longer claims somebody is
 * on it. Putting it back or closing it is one press in the row's own menu.
 *
 * `claim` is the reading from `claimLiveness`, handed in by the row so that
 * this pill, the health column and the meta line all draw one answer.
 */
export function Underway({
  startedAt,
  assignee,
  claim,
}: {
  startedAt: string;
  assignee: string | null;
  claim: ClaimLiveness | undefined;
}) {
  const since = startedAt.replace('T', ' ').slice(0, 16);
  const stopped = claim === 'abandoned';
  const silent = stopped || claim === 'quiet';

  return (
    <span
      title={
        stopped
          ? `Claimed ${since} and its run stopped without closing the step — close it or put it back.`
          : claim === 'quiet'
            ? `Claimed ${since}. Its run has pushed nothing for a while; it may still be reading or waiting on a build.`
            : // A session can start on anything approved, so an underway step
              // is a session's unless you kept it back. The column used to be
              // read the other way, when only a step handed over was Dash's.
              `${assignee === 'me' ? 'Underway' : 'Dash has been on this'} since ${since}`
      }
      className={cn(
        'tabular inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-small font-medium',
        silent ? 'bg-caution-tint text-caution' : 'bg-accent-tint text-accent',
      )}
    >
      <span
        className={cn('size-1.5 rounded-full', silent ? 'bg-caution' : 'animate-pulse bg-accent')}
        aria-hidden
      />
      <Elapsed startedAt={startedAt} />
      {stopped && <span className="sr-only"> with no session on it</span>}
      {claim === 'quiet' && <span className="sr-only"> with nothing pushed lately</span>}
    </span>
  );
}
