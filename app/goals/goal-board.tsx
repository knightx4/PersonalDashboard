import Link from 'next/link';
import { Bands } from '@/components/ui/meter';
import { cardVariants } from '@/components/ui/card';
import { DashMark } from '@/components/ui/dash-mark';
import { cn } from '@/lib/cn';
import { formatDay } from '@/lib/goals/dates';
import type { GoalHolders } from '@/lib/goals/hand-off';
import { nextMove, type HomeGoal } from '@/lib/goals/home';
import {
  PROGRESS_BANDS,
  PROGRESS_BAND_FILL,
  PROGRESS_BAND_WORD,
} from '@/lib/goals/status';
import { VerdictLabel } from './goal-line';

/**
 * The goal board at the top of the Goals home: every open goal as a card, so
 * where each one stands is the first thing on the page.
 *
 * A card reads top to bottom: its area (and for an errand, when it is due),
 * Dash's status, the title, a bar of its steps by who holds them, the next
 * move, and a footer saying how much is on you and whether Dash is on it now.
 * The whole card opens the goal.
 *
 * Errands come first, soonest due first, then the other goals in page order.
 * The order never depends on status, so a goal is in the same place from one
 * day to the next and can be found by where it sits.
 */

const LEGEND = PROGRESS_BANDS.filter((band) => band !== 'waiting');

export function GoalBoard({
  goals,
  holders,
  today,
}: {
  /** Errands first, then the rest, as splitErrands orders them. */
  goals: HomeGoal[];
  holders: Record<string, GoalHolders>;
  /** YYYY-MM-DD in the account's zone, for how long an errand has left. */
  today?: string;
}) {
  return (
    <section aria-labelledby="board-heading" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
        <h2 id="board-heading" className="text-ui font-semibold text-ink">
          Your goals
        </h2>
        <span className="flex flex-wrap items-center gap-x-3 text-small text-ink-muted">
          {LEGEND.map((band) => (
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
      <ul className="grid gap-2 sm:grid-cols-2">
        {goals.map((line) => (
          <GoalCard key={line.goal.id} line={line} holders={holders[line.goal.id]} today={today} />
        ))}
      </ul>
    </section>
  );
}

/** "today", "tomorrow", "in 6 days" or "3 days late", from today to a due date. */
export function dueIn(dueOn: string, today: string): string {
  const days = Math.round((Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 1) return `in ${days} days`;
  return days === -1 ? '1 day late' : `${-days} days late`;
}

function GoalCard({
  line,
  holders,
  today,
}: {
  line: HomeGoal;
  holders: GoalHolders | undefined;
  today?: string;
}) {
  const { goal, progress, review } = line;
  const move = nextMove(line);
  const late = Boolean(goal.errand && goal.dueOn && today && goal.dueOn < today);
  return (
    <li className="min-w-0">
      <Link
        href={`/goals/${goal.id}`}
        className={cn(
          cardVariants({ padding: 'dense', interactive: true }),
          'flex h-full flex-col gap-2',
        )}
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-small text-ink-muted">
            {goal.errand ? 'Errand' : line.areaName}
            {goal.errand && goal.dueOn && (
              <span className={cn('tabular', late && 'font-semibold text-danger')}>
                {' · '}Due {formatDay(goal.dueOn)}
                {today && `, ${dueIn(goal.dueOn, today)}`}
              </span>
            )}
          </span>
          {review && <VerdictLabel review={review} current={line.current} />}
        </span>

        <span className="text-ui font-semibold break-words text-ink">{goal.title}</span>

        {progress.live > 0 ? (
          <span className="flex items-center gap-2">
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
            <span className="tabular shrink-0 text-small text-ink-muted">
              {progress.done} of {progress.live}
            </span>
          </span>
        ) : null}

        <span className="line-clamp-2 text-small break-words text-ink-muted">
          {move ? (
            <>
              Next: <span className="text-ink">{move.text}</span>
              {move.on && `, ${formatDay(move.on)}`}
            </>
          ) : line.hasSteps ? (
            'Nothing is next on you or Dash.'
          ) : (
            'No steps yet. Open it to break it into steps.'
          )}
        </span>

        <Holders holders={holders} />
      </Link>
    </li>
  );
}

/** The card's footer: how much is on you, and what Dash has. */
function Holders({ holders }: { holders: GoalHolders | undefined }) {
  if (!holders) return null;
  const { onYou, dashOpen, working } = holders;
  if (onYou === 0 && dashOpen === 0 && !working) return null;
  return (
    <span className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 text-small text-ink-muted">
      {onYou > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-caution" aria-hidden />
          {onYou} on you
        </span>
      )}
      {working ? (
        <span className="inline-flex items-center gap-1 text-ink">
          <DashMark state="working" activity="thinking" size="2xs" tone="brand" decorative />
          Dash is on it now
        </span>
      ) : (
        dashOpen > 0 && (
          <span className="inline-flex items-center gap-1">
            <DashMark size="2xs" decorative />
            {dashOpen} with Dash
          </span>
        )
      )}
    </span>
  );
}
