'use client';

import { useActionState, useMemo, useState } from 'react';
import { ArrowRight, CalendarClock, ListTree, MessageSquare, Repeat, UserRound } from 'lucide-react';
import Link from '@/components/ui/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip, type ChipTone } from '@/components/ui/chip';
import { DashMark } from '@/components/ui/dash-mark';
import { Disclosure } from '@/components/ui/disclosure';
import { LinkedText } from '@/components/ui/linked-text';
import { Tooltip } from '@/components/ui/tooltip';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionLabel } from '@/components/ui/section-heading';
import { segmentedTrack, trackSegmentClass } from '@/components/ui/segmented';
import type { LinkedFile } from '@/lib/files/files';
import { cn } from '@/lib/cn';
import { stepHref } from '@/lib/goals/all-goals';
import { formatDay } from '@/lib/goals/dates';
import { dayIn } from '@/lib/todo/time';
import { closedSteps, firstSentence, stepPreps } from '@/lib/goals/goal-page';
import {
  LATER_SHOWN,
  planOrder,
  whoseLine,
  type PlanEntry,
  type PlanWait,
} from '@/lib/goals/plan-order';
import { awaitsReview } from '@/lib/goals/daily';
import type { GoalMap } from '@/lib/goals/steps-store';
import { useDashArrival } from './dash-arrival';
import { DashDraft } from './dash-draft';
import { NotNow } from './not-now';
import { workOnGoalAction, type ShapingActionState } from './shaping-actions';
import { Question } from './step-parts';
import { StripDone } from './strip-done';

export type PlanView = 'next' | 'stage';

const NO_FILES: Record<string, LinkedFile[]> = {};
const NO_INSET = {};
const NO_ARRIVALS: readonly string[] = [];

/** The glyph before each kind of wait, so the chip does not say it by colour alone. */
const WAIT_ICON: Record<PlanWait['kind'], typeof ArrowRight> = {
  date: CalendarClock,
  step: ArrowRight,
  person: UserRound,
  rhythm: Repeat,
};

/**
 * The chip's colour for what a later step waits on, as the approved mockups
 * draw it: a date and a named person in blue, another step in caution, a
 * rhythm plain. Blue is the app's base accent, which the goals workspace's
 * own accent (green) stands in for everywhere else on the page (plan
 * #2778.12).
 */
const WAIT_TONE: Record<PlanWait['kind'], ChipTone> = {
  date: 'neutral',
  step: 'caution',
  person: 'neutral',
  rhythm: 'neutral',
};
const BLUE = 'bg-w-chat-tint text-w-chat';

/** A wait's blue, for a date, and for a person only when the chip names them. */
function waitClass(wait: PlanWait): string | undefined {
  if (wait.kind === 'date') return BLUE;
  if (wait.kind === 'person' && wait.label !== 'Blocked') return BLUE;
  return undefined;
}

/**
 * A goal's Plan tab (plan #2778.5), as the approved mockups draw it: what is
 * on you now, what comes next in order, and why each later step waits, with
 * the finished steps folded away. Now is the one or two steps of yours that
 * nothing holds back, each with its buttons and Dash's draft inside; Up next
 * is the following few; Later lists the rest, each with what it waits on as a
 * chip. The order is lib/goals/plan-order.ts, which the Dashboard's strip and
 * the lists outside the goal read too.
 *
 * By stage (or By room) is the same steps grouped by stage in the tree's
 * rows, which the page draws in `byStage`; the switch is an address, so a
 * reload keeps it.
 */
export function GoalPlan({
  map,
  view,
  byStage,
  stageWord = 'stage',
  files = NO_FILES,
  canRun,
  today,
  timeZone,
  later: laterOpen = false,
  doneOpen = false,
  draftOpen = false,
  arrivals = NO_ARRIVALS,
}: {
  map: GoalMap;
  view: PlanView;
  /** The steps grouped by stage, drawn when `view` is `stage`. */
  byStage: React.ReactNode;
  /** What the goal's stages are called on the switch: room where they are rooms. */
  stageWord?: 'stage' | 'room';
  /** The files each step links to, which Dash's draft lists. */
  files?: Record<string, LinkedFile[]>;
  /** Whether this account can start a Dash run, which Help me plan this needs. */
  canRun: boolean;
  /** YYYY-MM-DD, the account's, which makes a due date near. */
  today: string;
  timeZone: string;
  /** Start with every later step listed. A seam for the gallery. */
  later?: boolean;
  /** Start with the finished fold open. A seam for the gallery. */
  doneOpen?: boolean;
  /** Start with Dash's drafts open. A seam for the gallery. */
  draftOpen?: boolean;
  /** The finished steps Dash closed lately, which arrive with its mark (moment "A step Dash finished"). */
  arrivals?: readonly string[];
}) {
  const order = useMemo(() => planOrder(map.steps, { today }), [map.steps, today]);
  const preps = useMemo(() => stepPreps([map.steps]).prepFor, [map.steps]);
  // The steps finished, as the progress counts them: done, and not a stage
  // or a step that only holds others.
  const closed = useMemo(() => {
    const holders = new Set<string>();
    const walk = (nodes: GoalMap['steps']) => {
      for (const node of nodes) {
        if (node.children.length > 0) holders.add(node.id);
        walk(node.children);
      }
    };
    walk(map.steps);
    return closedSteps(map.steps).filter((step) => step.status === 'done' && !holders.has(step.id));
  }, [map.steps]);
  const open = map.goal.status === 'open';
  const empty = order.now.length + order.next.length + order.later.length === 0;
  const help = open && canRun && <HelpMePlan goalId={map.goal.id} small />;

  if (map.steps.length === 0) {
    return (
      <EmptyState
        icon={ListTree}
        title="No plan yet"
        description="Dash can lay out the steps from what the goal is for."
        size="box"
        align="start"
      >
        {open && canRun && <HelpMePlan goalId={map.goal.id} />}
      </EmptyState>
    );
  }

  const stageLabel = stageWord === 'room' ? 'By room' : 'By stage';
  const draftOf = (entry: PlanEntry) => {
    const draft = draftFor(entry, preps[entry.id], files);
    return draft && { ...draft, defaultOpen: draftOpen, summary: false, aside: true };
  };
  const comments = (entry: PlanEntry) => map.threads[entry.id]?.length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* A grey track with the picked view raised on it, so the switch
            weighs less than the Now card under it (plan #2778.12). */}
        <span role="group" aria-label="Show the plan" className={segmentedTrack}>
          <Link
            href="?tab=plan"
            scroll={false}
            aria-current={view === 'next' ? 'true' : undefined}
            className={trackSegmentClass(view === 'next')}
          >
            What’s next
          </Link>
          <Link
            href="?tab=plan&view=stage"
            scroll={false}
            aria-current={view === 'stage' ? 'true' : undefined}
            className={trackSegmentClass(view === 'stage')}
          >
            {stageLabel}
          </Link>
        </span>
        {help}
      </div>

      {view === 'stage' ? (
        byStage
      ) : (
        <>
          {empty && (
            <Card padding="dense">
              <p className="text-ui text-ink-muted">
                Every step is finished. Help me plan this asks Dash for the next ones.
              </p>
            </Card>
          )}
          {order.now.length > 0 && (
            <section aria-labelledby="plan-now" className="space-y-2">
              <SectionLabel as="h2" className="px-1 text-accent">
                <span id="plan-now">Now</span>
              </SectionLabel>
              {order.now.map((entry) => (
                <StepCard
                  key={entry.id}
                  entry={entry}
                  goalId={map.goal.id}
                  draft={draftOf(entry)}
                  comments={comments(entry)}
                  now
                />
              ))}
            </section>
          )}
          {order.next.length > 0 && (
            <section aria-labelledby="plan-next" className="space-y-2">
              <SectionLabel as="h2" className="px-1">
                <span id="plan-next">Up next</span>
              </SectionLabel>
              {order.next.map((entry) => (
                <StepCard
                  key={entry.id}
                  entry={entry}
                  goalId={map.goal.id}
                  draft={draftOf(entry)}
                  comments={comments(entry)}
                />
              ))}
            </section>
          )}
          {order.later.length > 0 && (
            <LaterList
              entries={order.later}
              goalId={map.goal.id}
              comments={comments}
              defaultAll={laterOpen}
            />
          )}
          {closed.length > 0 && (
            <Card padding="none" className="px-3 py-2">
              <Disclosure title={`${closed.length} done`} defaultOpen={doneOpen}>
                <ul className="space-y-1 pt-1.5 text-small text-ink-muted">
                  {closed.map((step) => (
                    <DoneRow
                      key={step.id}
                      goalId={map.goal.id}
                      step={step}
                      arrived={arrivals.includes(step.id)}
                      timeZone={timeZone}
                    />
                  ))}
                </ul>
              </Disclosure>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

type Draft = React.ComponentProps<typeof DashDraft>;

/**
 * What Dash wrote for the step, as its row on the tree shows it: on a step of
 * yours the result of the Dash step that prepares it, or what Ask Dash
 * prepared on the step itself; on Dash's own step, what it found.
 */
function draftFor(
  entry: PlanEntry,
  prep: ReturnType<typeof stepPreps>['prepFor'][string] | undefined,
  files: Record<string, LinkedFile[]>,
): Draft | null {
  const step = entry.node;
  const own = files[step.id] ?? [];
  if (step.kind === 'claude') {
    return step.result || step.resultUrl || own.length > 0
      ? {
          label: step.preparesId ? 'Dash’s draft' : 'Dash found',
          markdown: step.result,
          url: step.resultUrl,
          files: own,
          readId: awaitsReview(step) ? step.id : null,
          inset: NO_INSET,
        }
      : null;
  }
  if (prep?.done && (prep.result || prep.resultUrl)) {
    return {
      label: 'Dash’s draft',
      markdown: prep.result,
      url: prep.resultUrl,
      files: files[prep.id] ?? [],
      readId: prep.unread ? prep.id : null,
      inset: NO_INSET,
    };
  }
  if (step.kind === 'mine' && (step.result || step.resultUrl || own.length > 0)) {
    return {
      label: 'Dash’s draft',
      markdown: step.result,
      url: step.resultUrl,
      files: own,
      inset: NO_INSET,
    };
  }
  return null;
}

/** The step's number in the plan, in a ring; filled for a step that is on you now. */
function StepNumber({ n, now = false, small = false }: { n: number; now?: boolean; small?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'tabular grid shrink-0 place-items-center rounded-full border-2 font-semibold',
        small ? 'size-6 text-micro' : 'size-7 text-small',
        now ? 'border-accent bg-accent text-surface' : 'border-border-strong text-ink-muted',
      )}
    >
      {n}
    </span>
  );
}

/** How many comments the step holds, as its row on the tree says it. */
function CommentCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="tabular inline-flex items-center gap-1 text-ink-muted">
      <MessageSquare className="size-3.5" strokeWidth={1.75} aria-hidden />
      {count}
      <span className="sr-only">{count === 1 ? 'comment' : 'comments'}</span>
    </span>
  );
}

/** A step under Now or Up next: its number, title, whose and where, why, and on Now its buttons. */
function StepCard({
  entry,
  goalId,
  draft,
  comments,
  now = false,
}: {
  entry: PlanEntry;
  goalId: string;
  draft: Draft | null;
  comments: number;
  now?: boolean;
}) {
  const step = entry.node;
  // Not now hides the card at once; the page then draws the step under Later.
  const [aside, setAside] = useState(false);
  if (aside) return null;
  // The step's detail as written, held to three lines; else its done-when's first sentence.
  const why = step.detail?.trim() || firstSentence(step.acceptance ?? '');
  const where = [entry.stage?.title, entry.under].filter(Boolean).join(' · ');
  return (
    <Card
      id={`step-${entry.id}`}
      padding="dense"
      className={cn(
        'grid scroll-mt-4 grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 gap-y-1',
        now && 'border-accent/40 ring-3 ring-accent-tint',
      )}
    >
      <StepNumber n={entry.number} now={now} />
      <div className="min-w-0 space-y-1">
        <Link
          href={stepHref(goalId, entry.id)}
          className="press-area block text-ui font-semibold break-words text-ink hover:text-accent"
        >
          {step.title}
        </Link>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-ink-muted">
          {step.dueOn && (
            <Chip size="sm" className={cn('font-semibold', BLUE)}>
              Before {formatDay(step.dueOn)}
            </Chip>
          )}
          <span>{whoseLine({ ...entry, node: { ...step, dueOn: null } })}</span>
          <CommentCount count={comments} />
          {where && <span className="min-w-0 break-words">{where}</span>}
        </p>
        {why && (
          <p className="line-clamp-3 text-small break-words whitespace-pre-line text-ink-muted">
            <LinkedText text={why} />
          </p>
        )}
        {now && entry.whose === 'question' && (
          <div className="-mx-1 pt-1">
            <Question node={step} />
          </div>
        )}
        {now && entry.whose === 'you' && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {/* Done and Not now, as the mockup draws the Now step; its title
                opens the step (plan #2778.12). */}
            <StripDone stepId={entry.id} />
            <NotNow stepId={entry.id} title={step.title} onAside={setAside} />
          </div>
        )}
        {draft && (
          <ul className="-mx-1 rounded-control bg-sunken px-2 pt-1.5">
            <DashDraft {...draft} />
          </ul>
        )}
      </div>
    </Card>
  );
}

/** Later: the rest of the open steps on one card, each with what it waits on. */
function LaterList({
  entries,
  goalId,
  comments,
  defaultAll,
}: {
  entries: PlanEntry[];
  goalId: string;
  comments: (entry: PlanEntry) => number;
  defaultAll: boolean;
}) {
  const [all, setAll] = useState(defaultAll);
  const shown = all ? entries : entries.slice(0, LATER_SHOWN);
  const hidden = entries.length - shown.length;
  // Where every later step sits in the same stage, saying so on each row tells them apart by nothing.
  const sameWhere = new Set(entries.map((entry) => entry.stage?.id ?? '')).size === 1;
  return (
    <section aria-labelledby="plan-later" className="space-y-2">
      <SectionLabel as="h2" className="px-1" count={entries.length}>
        <span id="plan-later">Later</span>
      </SectionLabel>
      <Card padding="none">
        <ul className="divide-y divide-border">
          {shown.map((entry) => {
            // The step's own why, else where it sits; never a line every row repeats.
            const where = [entry.stage?.title, entry.under].filter(Boolean).join(' · ');
            const line = firstSentence(entry.node.detail ?? '') || (sameWhere ? '' : where);
            // What holds the step, on a line of its own under that, since its
            // chip is kept short (plan #2778.11, #2778.12). A chip that names
            // the person holding it says enough, so that row keeps one line.
            const named = entry.waits?.kind === 'person' && entry.waits.label !== 'Blocked';
            const holds = named ? null : entry.waits?.detail;
            const Icon = entry.waits ? WAIT_ICON[entry.waits.kind] : null;
            return (
              <li
                key={entry.id}
                id={`step-${entry.id}`}
                className="card-pad-x row-pad grid scroll-mt-4 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3"
              >
                <StepNumber n={entry.number} small />
                <div className="min-w-0">
                  <Link
                    href={stepHref(goalId, entry.id)}
                    className="press-area block text-ui font-medium break-words text-ink hover:text-accent"
                  >
                    {entry.node.title}
                  </Link>
                  {(line || comments(entry) > 0) && (
                    <p className="flex flex-wrap items-center gap-x-3 text-small text-ink-muted">
                      {line && <span className="min-w-0 break-words">{line}</span>}
                      <CommentCount count={comments(entry)} />
                    </p>
                  )}
                  {holds && <p className="text-small break-words text-ink-muted">{holds}</p>}
                </div>
                {entry.waits && (
                  <Chip
                    tone={WAIT_TONE[entry.waits.kind]}
                    size="sm"
                    className={cn('max-w-40 justify-self-end font-semibold sm:max-w-xs', waitClass(entry.waits))}
                  >
                    {Icon && <Icon strokeWidth={1.75} aria-hidden />}
                    <span className="min-w-0 truncate">{entry.waits.label}</span>
                    {/* What the named person is to do, for a screen reader. */}
                    {named && entry.waits.detail && (
                      <span className="sr-only">: {entry.waits.detail}</span>
                    )}
                  </Chip>
                )}
              </li>
            );
          })}
          {hidden > 0 && (
            <li className="card-pad-x row-pad">
              <Button type="button" size="sm" variant="ghost" onClick={() => setAll(true)}>
                Show all {entries.length}
              </Button>
            </li>
          )}
        </ul>
      </Card>
    </section>
  );
}

/**
 * Help me plan this: asks Dash to map the goal's steps. The small button on
 * the bar above the plan, as the approved mockup draws it; the ordinary one
 * as the one thing a goal with no steps offers.
 */
function HelpMePlan({ goalId, small = false }: { goalId: string; small?: boolean }) {
  const [state, work, starting] = useActionState(workOnGoalAction, {} as ShapingActionState);
  return (
    <form action={work} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="goalId" value={goalId} />
      <Button
        type="submit"
        size={small ? 'xs' : 'sm'}
        variant="secondary"
        pending={starting}
        className={cn(small && 'px-2.5')}
      >
        Help me plan this
      </Button>
      {state.error ? (
        <span role="alert" className="text-small text-danger">
          {state.error}
        </span>
      ) : (
        state.message && (
          <span role="status" className="text-small text-ink-muted">
            {state.message}
          </span>
        )
      )}
    </form>
  );
}

/**
 * A finished step in the fold at the foot of the Plan tab, with Dash's mark
 * beside it when Dash closed it. One Dash closed lately settles in with its
 * mark flashing the first time the row is on screen (moment "A step Dash
 * finished"); under reduced motion it is simply there.
 */
function DoneRow({
  goalId,
  step,
  arrived,
  timeZone,
}: {
  goalId: string;
  step: ReturnType<typeof closedSteps>[number];
  arrived: boolean;
  timeZone: string;
}) {
  const markRef = useDashArrival(step.id, arrived);
  return (
    <li className="flex items-baseline justify-between gap-3">
      {/* One line: the title gives way with an ellipsis, so Dash's mark stays
          beside it and the date on the same line (plan #2778.11). */}
      <span className="flex min-w-0 items-baseline gap-1.5">
        <Link
          href={stepHref(goalId, step.id)}
          className="press-area min-w-0 truncate hover:text-ink"
        >
          {step.title}
        </Link>
        {/* Every step Dash closed keeps its mark, small and muted like the
            date, so the fold says at a glance which were Dash's (plan
            #2778.11); one closed lately also flashes it on arrival. */}
        {(step.dash || arrived) && (
          <Tooltip label="Finished by Dash" className="shrink-0">
            <span ref={markRef} className="inline-flex translate-y-0.5 text-ink-muted">
              <DashMark size="2xs" label="Dash's" />
            </span>
          </Tooltip>
        )}
      </span>
      <span className="tabular shrink-0 whitespace-nowrap">
        {formatDay(dayIn(step.closedAt, timeZone))}
      </span>
    </li>
  );
}
