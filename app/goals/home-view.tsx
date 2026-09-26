import Link from 'next/link';
import { Flag } from 'lucide-react';
import { FileBody } from '@/components/files/file-body';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { formatInstant } from '@/lib/goals/dates';
import type { DoneSince } from '@/lib/goals/done-since';
import { homeAreas, homeSummary, type HomeGoal, type WeekHealth } from '@/lib/goals/home';
import type { TodayItem } from '@/lib/goals/today';
import { DoneSinceList } from './done-since-list';
import { GoalLine } from './goal-line';
import { TodayList } from './today-list';

/**
 * The Goals home (plan #1077, under #1072), for a once-a-day visit. It
 * answers three questions and nothing sits above them: what to do today, how
 * each goal is doing, and what Dash did since you last looked.
 *
 * 1. One sentence on where the goals stand, from their statuses, with Dash's
 *    latest note folded under it when there is one.
 * 2. Today: at most five things, each with one button, and the rest folded
 *    under them (today-list.tsx).
 * 3. Your goals, one line each under their area: progress, status, and the
 *    next move with its date (goal-line.tsx).
 * 4. What Dash did since your last visit, with Read and Undo
 *    (done-since-list.tsx).
 *
 * What the old home listed in its own sections is reached from these: the
 * steps of yours, questions, approvals, flags, rhythms and suggestions are
 * all in Today or folded under it; results to read, the context and drafts
 * Dash found, and the Claude steps waiting on an approval are on each goal's
 * page; the runs going now are on the Runs tab.
 *
 * 5. This week: four numbers that say whether Goals is working (plan #1079),
 *    counted by weekHealth in lib/goals/home.ts.
 */

export type HomeViewProps = {
  goals: HomeGoal[];
  today: TodayItem[];
  later: TodayItem[];
  /** What Dash did since your last visit; null when it could not be read. */
  done: DoneSince | null;
  /** Dash's latest note on all the goals (goals.briefs), and when it was written. */
  brief: { body: string; when: string | null } | null;
  /** The account's zone, for the time of your last visit. */
  timeZone: string;
  /** The week's four numbers; null when they could not be read. */
  health: WeekHealth | null;
};

export function HomeView({ goals, today, later, done, brief, timeZone, health }: HomeViewProps) {
  if (goals.length === 0 && today.length === 0 && later.length === 0) {
    return (
      <EmptyState
        icon={Flag}
        title="No goals yet"
        description="Add the goals you are working towards. Each gets a status every morning, and what to do about them shows here."
        action={{ label: 'Add a goal', href: '/goals/all' }}
      />
    );
  }

  const summary = homeSummary(goals);
  return (
    <div className="space-y-8">
      {(summary || brief) && (
        <div className="space-y-1 px-1">
          {summary && <p className="text-body text-ink">{summary}</p>}
          {brief && (
            <Disclosure title="Dash’s note" meta={brief.when ? `written ${brief.when}` : undefined}>
              <FileBody markdown={brief.body} compact />
            </Disclosure>
          )}
        </div>
      )}

      <TodayList today={today} later={later} />

      {goals.length > 0 && <GoalLines goals={goals} />}

      <DoneSection done={done} timeZone={timeZone} />

      <WeekSection health={health} />
    </div>
  );
}

function GoalLines({ goals }: { goals: HomeGoal[] }) {
  return (
    <section aria-labelledby="goals-heading" className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 id="goals-heading" className="text-ui font-semibold text-ink">
          Your goals
        </h2>
        <span className="tabular text-small text-ink-muted">{goals.length} open</span>
      </div>
      <div className="space-y-4">
        {homeAreas(goals).map((area) => (
          <div key={area.areaId} className="space-y-1">
            <h3 className="px-1 text-small font-semibold text-ink-muted">
              <Link
                href={`/goals/area/${area.areaId}`}
                className="underline-offset-2 hover:text-ink hover:underline"
              >
                {area.areaName}
              </Link>
            </h3>
            <Card>
              <ul className="divide-y divide-border">
                {area.goals.map((line) => (
                  <GoalLine key={line.goal.id} line={line} />
                ))}
              </ul>
            </Card>
          </div>
        ))}
      </div>
    </section>
  );
}

function DoneSection({ done, timeZone }: { done: DoneSince | null; timeZone: string }) {
  return (
    <section aria-labelledby="done-heading" className="space-y-2">
      <h2 id="done-heading" className="px-1 text-ui font-semibold text-ink">
        {done ? `What Dash did since ${formatInstant(done.since, timeZone)}` : 'What Dash did'}
      </h2>
      {done && done.items.length > 0 ? (
        <DoneSinceList done={done} />
      ) : (
        <p className="px-1 text-small text-ink-muted">
          {done
            ? 'Nothing new since your last visit.'
            : 'This could not be read just now. Every run is on the Runs tab.'}
        </p>
      )}
    </section>
  );
}

function WeekSection({ health }: { health: WeekHealth | null }) {
  const stats = health
    ? [
        {
          value: health.dashFinished,
          label: health.dashFinished === 1 ? 'step Dash finished' : 'steps Dash finished',
        },
        { value: health.waitingOnYou, label: 'waiting on you' },
        {
          value: health.stuck,
          label:
            health.stuck === 1
              ? 'step of yours untouched for a week'
              : 'steps of yours untouched for a week',
        },
        {
          value: health.daysVisited,
          label: health.daysVisited === 1 ? 'day you visited' : 'days you visited',
        },
      ]
    : null;
  return (
    <section aria-labelledby="week-heading" className="space-y-2">
      <h2 id="week-heading" className="px-1 text-ui font-semibold text-ink">
        This week
      </h2>
      {stats ? (
        <Card padding="dense">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className="flex flex-col-reverse gap-1">
                <dt className="text-small text-ink-muted">{stat.label}</dt>
                <dd className="tabular text-title font-semibold text-ink">{stat.value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ) : (
        <p className="px-1 text-small text-ink-muted">
          The week’s numbers could not be read just now.
        </p>
      )}
    </section>
  );
}
