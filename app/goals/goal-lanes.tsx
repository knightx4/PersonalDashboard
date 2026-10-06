'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DashMark } from '@/components/ui/dash-mark';
import { MoveLabel } from '@/components/ui/move-label';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { areaHref } from '@/lib/goals/all-goals';
import { formatDay } from '@/lib/goals/dates';
import type { DashOffer } from '@/lib/goals/hand-off';
import { nextMove, type HomeGoal } from '@/lib/goals/home';
import type { DashLaneItem, LaterLaneItem } from '@/lib/goals/lanes';
import { VERDICT_LABELS } from '@/lib/goals/reviews';
import type { RunListing } from '@/lib/goals/runs';
import type { TodayItem } from '@/lib/goals/today';
import { workOnGoalAction } from './[goalId]/shaping-actions';
import { FoldLine } from './fold-line';
import { VERDICT_TONES } from './goal-line';
import { bringBackAction } from './home-actions';
import { TodayRow } from './today-list';

/**
 * What is next on the Goals home, in the order you act on it.
 *
 * - Do next: at most five things on you from the week's goals, ranked
 *   (homeLists in lib/goals/home.ts), each with its one button, Not now, and
 *   Ask Dash where Dash can prepare it. A step Dash prepared something for
 *   shows the first lines of it, with Open and Copy (today-list.tsx).
 * - Dash is on N things: one line that opens to the runs going now, Dash's
 *   open steps, and goals Dash has left alone, offered with Ask Dash. Ask
 *   Dash shows only to the account that owns the app, as on a goal's page,
 *   because only that account can start a run.
 * - What Dash did since your last visit, passed in as `since`.
 * - Later: the rest of what is on you in the week's goals, and what is set
 *   aside until a later day, with Bring back now.
 * - Other goals: the goals that are not this week's, one line each, under
 *   their areas.
 *
 * Moves show at once: a step set aside leaves Do next, a step handed to Dash
 * joins Dash's line, and one brought back leaves Later. The server's redraw
 * then puts each where it really is.
 */

export type GoalLanesProps = {
  /** Do next, ranked. */
  doNext: TodayItem[];
  /** The rest of what is on you in the week's goals, ranked. */
  rest: TodayItem[];
  /** The goals Do next leaves out, errands first. */
  otherGoals: HomeGoal[];
  /** YYYY-MM-DD in the account's zone. */
  todayOn?: string;
  preparable: string[];
  dash: DashLaneItem[];
  laterOn: LaterLaneItem[];
  working: RunListing[];
  offers: DashOffer[];
  /** Whether this account can start a run (the owner's only), which Ask Dash needs. */
  canRun?: boolean;
  /** The line for what Dash did since your last visit, drawn between Dash's line and Later. */
  since?: React.ReactNode;
};

/** "today", "tomorrow", "in 6 days" or "3 days late", from today to a due date. */
export function dueIn(dueOn: string, today: string): string {
  const days = Math.round(
    (Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 1) return `in ${days} days`;
  return days === -1 ? '1 day late' : `${-days} days late`;
}

const keyOf = (item: TodayItem) => `${item.kind}:${item.id}`;

const things = (n: number) => (n === 1 ? '1 thing' : `${n} things`);

export function GoalLanes({
  doNext,
  rest,
  otherGoals,
  todayOn,
  preparable,
  dash,
  laterOn,
  working,
  offers,
  canRun = false,
  since,
}: GoalLanesProps) {
  // Moves made on this page, shown before the server's redraw arrives.
  const [aside, setAside] = useState<ReadonlySet<string>>(new Set());
  const [handed, setHanded] = useState<TodayItem[]>([]);
  const [back, setBack] = useState<ReadonlySet<string>>(new Set());
  const toggle = (set: ReadonlySet<string>, key: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(key);
    else next.delete(key);
    return next;
  };

  const handedKeys = new Set(handed.map(keyOf));
  const shown = (item: TodayItem) => !aside.has(keyOf(item)) && !handedKeys.has(keyOf(item));
  const mine = doNext.filter(shown);
  const more = rest.filter(shown);
  const listed = new Set(dash.map((item) => item.id));
  const dashRows: DashLaneItem[] = [
    ...handed
      .filter((item) => !listed.has(item.id))
      .map((item) => ({
        id: item.id,
        title: item.title,
        goalId: item.goalId,
        goalTitle: item.goalTitle,
        kind: 'preparing' as const,
        working: true,
        needs: null,
      })),
    ...dash,
  ];
  const quiet = offers.filter(
    (offer): offer is Extract<DashOffer, { kind: 'goal' }> => offer.kind === 'goal',
  );
  const later = laterOn.filter((item) => !back.has(item.id));
  const canPrepare = new Set(canRun ? preparable : []);
  const dashCount = dashRows.length + working.length;
  const needsYou = dashRows.filter((item) => item.needs).length;

  const row = (item: TodayItem) => (
    <TodayRow
      key={keyOf(item)}
      item={item}
      rank={null}
      preparable={canPrepare.has(item.id)}
      onAside={(hidden) => setAside((current) => toggle(current, keyOf(item), hidden))}
      onHanded={() => setHanded((current) => [...current, item])}
    />
  );

  return (
    <div className="space-y-6">
      <section aria-labelledby="do-next-heading" className="space-y-2">
        <h2 id="do-next-heading" className="px-1 text-ui font-semibold text-ink">
          Do next
        </h2>
        <Card>
          {mine.length === 0 ? (
            <p className="card-pad-x row-pad text-small text-ink-muted">
              Nothing is waiting on you in this week’s goals.
            </p>
          ) : (
            <ul className="divide-y divide-border">{mine.map(row)}</ul>
          )}
        </Card>
      </section>

      <div className="space-y-1">
        <FoldLine
          title={
            <span className="inline-flex items-center gap-1.5">
              <DashMark
                state={working.length > 0 ? 'working' : undefined}
                activity={working.length > 0 ? 'thinking' : undefined}
                size="2xs"
                tone="brand"
                decorative
              />
              {dashCount > 0 ? `Dash is on ${things(dashCount)}` : 'Nothing with Dash'}
            </span>
          }
          meta={
            needsYou > 0
              ? `${needsYou} ${needsYou === 1 ? 'needs' : 'need'} an answer from you`
              : quiet.length > 0
                ? `it could take ${quiet.length === 1 ? '1 goal' : `${quiet.length} goals`}`
                : undefined
          }
        >
          <Card>
            {dashCount === 0 ? (
              <p className="card-pad-x row-pad text-small text-ink-muted">
                {canRun
                  ? 'Press Ask Dash on a step of yours, or ask Dash above.'
                  : 'Dash has nothing open.'}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {working.map((run) => (
                  <WorkingRow key={`run:${run.id}`} run={run} />
                ))}
                {dashRows.map((item) => (
                  <DashRow key={`dash:${item.id}`} item={item} />
                ))}
              </ul>
            )}
            {quiet.length > 0 && (
              <div className="border-t border-border">
                <p className="card-pad-x pt-3 text-small font-semibold text-ink-muted">
                  Dash could take these
                </p>
                <ul className="divide-y divide-border">
                  {quiet.map((offer) => (
                    <QuietGoalRow key={offer.goalId} offer={offer} canRun={canRun} />
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </FoldLine>

        {since}

        {more.length + later.length > 0 && (
          <FoldLine
            title="Later"
            meta={[
              more.length > 0 ? `${more.length} more on you` : null,
              later.length > 0 ? `${later.length} set aside` : null,
            ]
              .filter(Boolean)
              .join(', ')}
          >
            <Card>
              {more.length > 0 && <ul className="divide-y divide-border">{more.map(row)}</ul>}
              {later.length > 0 && (
                <div className={cn(more.length > 0 && 'border-t border-border')}>
                  <p className="card-pad-x pt-3 text-small font-semibold text-ink-muted">
                    Set aside
                  </p>
                  <ul className="divide-y divide-border">
                    {later.map((item) => (
                      <LaterRow
                        key={`later:${item.id}`}
                        item={item}
                        onBack={(gone) => setBack((current) => toggle(current, item.id, gone))}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          </FoldLine>
        )}

        {otherGoals.length > 0 && (
          <FoldLine title="Other goals" meta={String(otherGoals.length)}>
            {/* By area, each area's name opening its page (note b4595cb6). */}
            {byArea(otherGoals).map((group) => (
              <section key={group.areaId} aria-label={group.areaName} className="space-y-1">
                <Link
                  href={areaHref(group.areaId)}
                  className={cn(
                    'inline-flex items-baseline gap-2 px-1 text-small font-medium text-ink-muted',
                    'underline-offset-2 hover:text-ink hover:underline max-sm:min-h-11 max-sm:items-center',
                  )}
                >
                  {group.areaName}
                  <span className="font-normal text-ink-ghost">{group.goals.length}</span>
                </Link>
                <Card>
                  <ul className="divide-y divide-border">
                    {group.goals.map((line) => (
                      <OtherGoalRow key={line.goal.id} line={line} today={todayOn} />
                    ))}
                  </ul>
                </Card>
              </section>
            ))}
            <Link
              href="/goals/all"
              className="inline-flex items-center px-1 text-small text-accent underline-offset-2 hover:underline max-sm:min-h-11"
            >
              All goals
            </Link>
          </FoldLine>
        )}
      </div>
    </div>
  );
}

/**
 * The other goals under their areas, each area where its first goal falls in
 * the order given, so the errands that lead the list still lead it.
 */
export function byArea(lines: HomeGoal[]): { areaId: string; areaName: string; goals: HomeGoal[] }[] {
  const groups = new Map<string, { areaId: string; areaName: string; goals: HomeGoal[] }>();
  for (const line of lines) {
    const group = groups.get(line.goal.areaId);
    if (group) group.goals.push(line);
    else groups.set(line.goal.areaId, { areaId: line.goal.areaId, areaName: line.areaName, goals: [line] });
  }
  return [...groups.values()];
}

/**
 * A goal that is not this week's, on one line: its title, its status word
 * (or, for an errand, when it is due), and its next move. Pressing it opens
 * the goal.
 */
function OtherGoalRow({ line, today }: { line: HomeGoal; today?: string }) {
  const { goal, review } = line;
  const move = nextMove(line);
  const late = Boolean(goal.errand && goal.dueOn && today && goal.dueOn < today);
  const tone = review ? VERDICT_TONES[review.verdict] : null;
  const word =
    goal.errand && goal.dueOn
      ? `Due ${formatDay(goal.dueOn)}${today ? `, ${dueIn(goal.dueOn, today)}` : ''}`
      : review
        ? VERDICT_LABELS[review.verdict]
        : null;
  return (
    <li>
      <Link
        href={`/goals/${goal.id}`}
        className="card-pad-x row-pad flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-small hover:bg-sunken max-sm:min-h-11"
      >
        <span className="min-w-0 text-ui font-semibold break-words text-ink">{goal.title}</span>
        {word && (
          <span
            className={cn(
              'whitespace-nowrap',
              late
                ? 'font-semibold text-danger'
                : goal.errand
                  ? 'text-ink-muted'
                  : !line.current
                    ? 'text-ink-ghost'
                    : tone === 'positive'
                      ? 'text-positive'
                      : tone === 'caution'
                        ? 'text-caution'
                        : 'text-ink-muted',
            )}
          >
            {word}
            {/* A status from a missed morning run is greyed, and says its day to a screen reader. */}
            {review && !goal.errand && !line.current && (
              <span className="sr-only"> as of {formatDay(review.createdAt.slice(0, 10))}</span>
            )}
          </span>
        )}
        {move && (
          <span className="min-w-0 break-words text-ink-muted">
            Next: {move.text}
            {move.on ? `, ${formatDay(move.on)}` : ''}
          </span>
        )}
      </Link>
    </li>
  );
}

function WorkingRow({ run }: { run: RunListing }) {
  const on = run.nowOn?.trim() || run.item?.title || run.area?.name || 'the morning run';
  return (
    <li className="card-pad-x row-pad flex items-start gap-2">
      <DashMark state="working" activity="thinking" size="xs" tone="brand" decorative />
      <span className="min-w-0 flex-1 text-small break-words text-ink">
        Working on <span className="font-semibold">{on}</span>
      </span>
      <Link
        href={`/goals/runs/${run.id}`}
        className="press-area shrink-0 text-small text-accent underline-offset-2 hover:underline"
      >
        Watch
      </Link>
    </li>
  );
}

function DashRow({ item }: { item: DashLaneItem }) {
  return (
    <li className="card-pad-x row-pad space-y-1">
      <Link
        href={`/goals/${item.goalId}#step-${item.id}`}
        className="block text-ui font-semibold break-words text-ink underline-offset-2 hover:underline"
      >
        {item.title}
      </Link>
      <p className="text-small break-words text-ink-muted">{item.goalTitle}</p>
      {item.needs ? (
        <p className="text-small break-words text-caution">Needs you: {item.needs}</p>
      ) : (
        // The move, in the words every row uses (plan #1455): Dash is on it
        // while a run on the step or its goal is going, and With Dash while it
        // waits for the next one.
        <p className="text-small">
          <MoveLabel
            move={{ state: item.working ? 'dash_working' : 'with_dash' }}
            title={
              item.working
                ? item.kind === 'preparing'
                  ? 'Dash is preparing this for you now.'
                  : 'Dash is working on this now.'
                : 'Queued for Dash’s next run.'
            }
          />
        </p>
      )}
    </li>
  );
}

type RunState = { error?: string; message?: string; done?: number };

function QuietGoalRow({
  offer,
  canRun,
}: {
  offer: Extract<DashOffer, { kind: 'goal' }>;
  canRun: boolean;
}) {
  const [state, action, pending] = useActionState(
    (prev: RunState, form: FormData) => workOnGoalAction(prev, form),
    {} as RunState,
  );
  const started = !state.error && state.done !== undefined;
  return (
    <li className="card-pad-x row-pad space-y-1">
      <Link
        href={`/goals/${offer.goalId}`}
        className="block text-ui font-semibold break-words text-ink underline-offset-2 hover:underline"
      >
        {offer.title}
      </Link>
      <p className="text-small break-words text-ink-muted">{offer.reason}</p>
      {state.error && <p className="text-small text-danger">{state.error}</p>}
      {started ? (
        <p className="text-small" role="status">
          <MoveLabel move={{ state: 'dash_working' }} />
        </p>
      ) : (
        canRun && (
          <form action={action} className="pt-1">
            <input type="hidden" name="goalId" value={offer.goalId} />
            <Button type="submit" size="sm" variant="secondary" pending={pending}>
              {pending ? 'Asking…' : 'Ask Dash'}
            </Button>
          </form>
        )
      )}
    </li>
  );
}

function LaterRow({ item, onBack }: { item: LaterLaneItem; onBack: (gone: boolean) => void }) {
  const toast = useToast();
  return (
    <li className="card-pad-x row-pad space-y-1">
      <Link
        href={`/goals/${item.goalId}#step-${item.id}`}
        className="block text-ui font-semibold break-words text-ink underline-offset-2 hover:underline"
      >
        {item.title}
      </Link>
      <p className="text-small break-words text-ink-muted">
        {item.goalTitle} · back {formatDay(item.startsOn)}
        {item.dueOn && `, due ${formatDay(item.dueOn)}`}
      </p>
      <div className="pt-1">
        <button
          type="button"
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          onClick={async () => {
            onBack(true);
            const form = new FormData();
            form.set('id', item.id);
            const result = await bringBackAction(form);
            if (result.error) {
              onBack(false);
              toast({ text: result.error });
              return;
            }
            toast({ text: 'Back on you.' });
          }}
        >
          Bring back now
        </button>
      </div>
    </li>
  );
}
