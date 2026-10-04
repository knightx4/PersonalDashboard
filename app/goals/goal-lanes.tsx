'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, cardVariants } from '@/components/ui/card';
import { DashMark } from '@/components/ui/dash-mark';
import { Bands } from '@/components/ui/meter';
import { MoveLabel } from '@/components/ui/move-label';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { formatDay } from '@/lib/goals/dates';
import type { DashOffer, GoalHolders } from '@/lib/goals/hand-off';
import { nextMove, type HomeGoal } from '@/lib/goals/home';
import type { DashLaneItem, LaterLaneItem } from '@/lib/goals/lanes';
import { VERDICT_LABELS } from '@/lib/goals/reviews';
import type { RunListing } from '@/lib/goals/runs';
import { PROGRESS_BANDS, PROGRESS_BAND_FILL, PROGRESS_BAND_WORD } from '@/lib/goals/status';
import type { TodayItem } from '@/lib/goals/today';
import { workOnGoalAction } from './[goalId]/shaping-actions';
import { VERDICT_TONES } from './goal-line';
import { bringBackAction } from './home-actions';
import { TodayRow } from './today-list';

/**
 * Your goals and the three lanes on the Goals home.
 *
 * The goals are small tiles, every one on the page at once: errands first,
 * then page order, so a goal is in the same place from day to day. A tile
 * says its status, a bar of its steps by who holds them, and how much is on
 * you. Pressing one filters the lanes to that goal; pressing it again, or
 * Show every goal, clears the filter.
 *
 * The lanes sort what is next by who holds it:
 *
 * - On you: everything ranked as on you (lib/goals/today.ts), each with its
 *   one button, Not now, and Ask Dash where Dash can prepare it.
 * - Dash has it: the runs going now, Dash's open steps (working, queued, or
 *   waiting on an answer from you), and goals Dash has left alone, offered
 *   with Ask Dash. Ask Dash shows only to the account that owns the app, as
 *   on a goal's page, because only that account can start a run.
 * - Later: what is set aside until a later day, with Bring back now.
 *
 * Moves between lanes show at once: a step set aside leaves On you, a step
 * handed to Dash appears in Dash's lane, and one brought back leaves Later.
 * The server's redraw then puts each where it really is.
 */

/** How many rows a lane shows before Show more. */
const LANE_ROWS = 6;

export type GoalLanesProps = {
  /** Errands first, then the rest, as splitErrands orders them. */
  goals: HomeGoal[];
  holders: Record<string, GoalHolders>;
  /** YYYY-MM-DD in the account's zone. */
  todayOn?: string;
  /** Everything on you, ranked. */
  onYou: TodayItem[];
  preparable: string[];
  dash: DashLaneItem[];
  laterOn: LaterLaneItem[];
  working: RunListing[];
  offers: DashOffer[];
  /** Whether this account can start a run (the owner's only), which Ask Dash needs. */
  canRun?: boolean;
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

export function GoalLanes({
  goals,
  holders,
  todayOn,
  onYou,
  preparable,
  dash,
  laterOn,
  working,
  offers,
  canRun = false,
}: GoalLanesProps) {
  const [filter, setFilter] = useState<string | null>(null);
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

  const inFilter = (goalId: string) => filter === null || goalId === filter;
  const handedKeys = new Set(handed.map(keyOf));
  const mine = onYou.filter(
    (item) => inFilter(item.goalId) && !aside.has(keyOf(item)) && !handedKeys.has(keyOf(item)),
  );
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
  ].filter((item) => inFilter(item.goalId));
  const runs = working.filter(
    (run) => !run.item || (run.item.level === 'goal' ? inFilter(run.item.id) : filter === null),
  );
  const quiet = offers.filter(
    (offer): offer is Extract<DashOffer, { kind: 'goal' }> =>
      offer.kind === 'goal' && inFilter(offer.goalId),
  );
  const later = laterOn.filter((item) => inFilter(item.goalId) && !back.has(item.id));
  const canPrepare = new Set(canRun ? preparable : []);
  const chosen = goals.find((line) => line.goal.id === filter) ?? null;

  return (
    <div className="space-y-6">
      <section aria-labelledby="tiles-heading" className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
          <h2 id="tiles-heading" className="text-ui font-semibold text-ink">
            Your goals
          </h2>
          <span className="flex flex-wrap items-center gap-x-3 text-small text-ink-muted">
            {PROGRESS_BANDS.filter((band) => band !== 'waiting').map((band) => (
              <span key={band} className="inline-flex items-center gap-1.5">
                <span className={cn('size-2 rounded-full', PROGRESS_BAND_FILL[band])} aria-hidden />
                {PROGRESS_BAND_WORD[band]}
              </span>
            ))}
            <Link href="/goals/all" className="text-accent underline-offset-2 hover:underline">
              All goals
            </Link>
          </span>
        </div>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {goals.map((line) => (
            <GoalTile
              key={line.goal.id}
              line={line}
              holders={holders[line.goal.id]}
              today={todayOn}
              pressed={filter === line.goal.id}
              onPress={() => setFilter(filter === line.goal.id ? null : line.goal.id)}
            />
          ))}
        </ul>
        {chosen && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-small text-ink-muted" role="status">
            <span>
              Showing <span className="font-semibold text-ink">{chosen.goal.title}</span>
            </span>
            <Link href={`/goals/${chosen.goal.id}`} className="text-accent underline-offset-2 hover:underline">
              Open the goal
            </Link>
            <button
              type="button"
              className="text-accent underline-offset-2 hover:underline"
              onClick={() => setFilter(null)}
            >
              Show every goal
            </button>
          </p>
        )}
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Lane
          id="lane-you"
          title="On you"
          dot="bg-caution"
          count={mine.length}
          empty="Nothing is waiting on you."
          rows={mine.map((item) => (
            <TodayRow
              key={keyOf(item)}
              item={item}
              rank={null}
              preparable={canPrepare.has(item.id)}
              onAside={(hidden) => setAside((current) => toggle(current, keyOf(item), hidden))}
              onHanded={() => setHanded((current) => [...current, item])}
            />
          ))}
        />
        <Lane
          id="lane-dash"
          title="Dash has it"
          dot="bg-status-submitted"
          count={dashRows.length + runs.length}
          empty={
            canRun
              ? 'Nothing with Dash. Press Ask Dash on a step of yours, or ask Dash above.'
              : 'Nothing with Dash.'
          }
          rows={[
            ...runs.map((run) => <WorkingRow key={`run:${run.id}`} run={run} />),
            ...dashRows.map((item) => <DashRow key={`dash:${item.id}`} item={item} />),
          ]}
          footer={
            quiet.length > 0 ? (
              <>
                <p className="card-pad-x pt-3 text-small font-semibold text-ink-muted">
                  Dash could take these
                </p>
                <ul className="divide-y divide-border">
                  {quiet.map((offer) => (
                    <QuietGoalRow key={offer.goalId} offer={offer} canRun={canRun} />
                  ))}
                </ul>
              </>
            ) : null
          }
        />
        <Lane
          id="lane-later"
          title="Later"
          dot="bg-ink-ghost"
          count={later.length}
          empty="Nothing set aside. Not now on a step puts it here until the day you pick."
          rows={later.map((item) => (
            <LaterRow
              key={`later:${item.id}`}
              item={item}
              onBack={(gone) => setBack((current) => toggle(current, item.id, gone))}
            />
          ))}
        />
      </div>
    </div>
  );
}

function GoalTile({
  line,
  holders,
  today,
  pressed,
  onPress,
}: {
  line: HomeGoal;
  holders: GoalHolders | undefined;
  today?: string;
  pressed: boolean;
  onPress: () => void;
}) {
  const { goal, progress, review } = line;
  const late = Boolean(goal.errand && goal.dueOn && today && goal.dueOn < today);
  const tone = review ? VERDICT_TONES[review.verdict] : null;
  const move = nextMove(line);
  return (
    <li className="min-w-0">
      <button
        type="button"
        aria-pressed={pressed}
        title={move ? `Next: ${move.text}${move.on ? `, ${formatDay(move.on)}` : ''}` : undefined}
        onClick={onPress}
        className={cn(
          cardVariants({ padding: 'dense', interactive: true }),
          'flex h-full w-full flex-col gap-1.5 text-left',
          pressed && 'ring-2 ring-accent',
        )}
      >
        <span className="flex items-baseline justify-between gap-2 text-small">
          <span className={cn('min-w-0 truncate text-ink-muted', late && 'font-semibold text-danger')}>
            {goal.errand && goal.dueOn
              ? `Due ${formatDay(goal.dueOn)}${today ? `, ${dueIn(goal.dueOn, today)}` : ''}`
              : line.areaName}
          </span>
          {review && (
            <span
              className={cn(
                'shrink-0 font-semibold whitespace-nowrap',
                !line.current && 'text-ink-ghost',
                line.current && tone === 'positive' && 'text-positive',
                line.current && tone === 'caution' && 'text-caution',
                line.current && tone === 'quiet' && 'text-ink-muted',
              )}
            >
              {VERDICT_LABELS[review.verdict]}
              {/* A status from a missed morning run is greyed, and says its day to a screen reader. */}
              {!line.current && <span className="sr-only"> as of {formatDay(review.createdAt.slice(0, 10))}</span>}
            </span>
          )}
        </span>
        <span className="line-clamp-2 text-ui leading-snug font-semibold break-words text-ink">
          {goal.title}
        </span>
        <span className="mt-auto flex items-center gap-2 pt-0.5">
          {progress.live > 0 ? (
            <Bands
              bands={PROGRESS_BANDS.map((band) => ({
                key: band,
                value: progress.bands[band],
                fill: PROGRESS_BAND_FILL[band],
                label: `${progress.bands[band]} ${PROGRESS_BAND_WORD[band]}`,
              }))}
              track="sunken"
              label={goal.title}
              className="flex-1"
            />
          ) : (
            <span className="flex-1 text-small text-ink-ghost">No steps yet</span>
          )}
          {holders?.working ? (
            <DashMark state="working" activity="thinking" size="2xs" tone="brand" label="Dash is on it now" />
          ) : null}
          {progress.live > 0 && (
            <span className="tabular shrink-0 text-small text-ink-muted">
              {progress.done}/{progress.live}
            </span>
          )}
          {(holders?.onYou ?? 0) > 0 && (
            <span className="tabular shrink-0 text-small text-caution">{holders!.onYou} on you</span>
          )}
        </span>
      </button>
    </li>
  );
}

function Lane({
  id,
  title,
  dot,
  count,
  rows,
  empty,
  footer,
}: {
  id: string;
  title: string;
  /** The background utility of the lane's dot. */
  dot: string;
  count: number;
  rows: React.ReactNode[];
  empty: string;
  footer?: React.ReactNode;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, LANE_ROWS);
  const hidden = rows.length - shown.length;
  return (
    <section aria-labelledby={id} className="min-w-0 space-y-2">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 id={id} className="inline-flex items-center gap-1.5 text-ui font-semibold text-ink">
          <span className={cn('size-2 rounded-full', dot)} aria-hidden />
          {title}
        </h2>
        <span className="tabular text-small text-ink-muted">{count}</span>
      </div>
      <Card>
        {rows.length === 0 ? (
          <p className="card-pad-x row-pad text-small text-ink-muted">{empty}</p>
        ) : (
          <ul className="divide-y divide-border">{shown}</ul>
        )}
        {(hidden > 0 || all) && rows.length > LANE_ROWS && (
          <button
            type="button"
            onClick={() => setAll(!all)}
            className="card-pad-x row-pad w-full border-t border-border text-left text-small text-accent hover:underline"
          >
            {all ? 'Show fewer' : `Show ${hidden} more`}
          </button>
        )}
        {footer && <div className="border-t border-border">{footer}</div>}
      </Card>
    </section>
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
        className="shrink-0 text-small text-accent underline-offset-2 hover:underline"
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
