import Link from 'next/link';
import { Flag } from 'lucide-react';
import { FileBody } from '@/components/files/file-body';
import { Card } from '@/components/ui/card';
import { DashMark } from '@/components/ui/dash-mark';
import { EmptyState } from '@/components/ui/empty-state';
import { daysAway } from '@/lib/goals/catch-up';
import { formatInstant } from '@/lib/goals/dates';
import type { DoneSince } from '@/lib/goals/done-since';
import type { DashOffer, GoalHolders } from '@/lib/goals/hand-off';
import {
  errandAreaDefault,
  homeSummary,
  splitErrands,
  type HomeGoal,
  type WeekHealth,
} from '@/lib/goals/home';
import type { DashLaneItem, LaterLaneItem } from '@/lib/goals/lanes';
import type { RunListing } from '@/lib/goals/runs';
import type { TodayItem } from '@/lib/goals/today';
import { AskDash } from './ask-dash';
import { DoneSinceList } from './done-since-list';
import { GoalLanes } from './goal-lanes';
import { DashCredit } from '@/components/ui/dash-mark';

/**
 * The Goals home (plan #1077, under #1072), for a once-a-day visit.
 *
 * 1. The briefing: Dash's morning note on all the goals (goals.briefs), with
 *    one sentence on where the goals stand under it, and Ask Dash, which
 *    goes to a goal or starts a new goal or errand (ask-dash.tsx). Before
 *    the first note is written, the sentence stands alone.
 * 2. Your goals and the lanes (goal-lanes.tsx): every goal as a small tile
 *    that opens it, and what is next sorted into On you, Dash has it, and
 *    Later.
 * 3. What Dash did since your last visit, with Read and Undo
 *    (done-since-list.tsx), and the link to every run.
 * 4. This week: four numbers that say whether Goals is working (plan #1079),
 *    counted by weekHealth in lib/goals/home.ts.
 *
 * The day you come back after five or more days away (lib/goals/catch-up.ts),
 * the briefing says how long you were gone, What Dash did moves up under it,
 * and This week is left out.
 *
 * What the old home listed in its own sections is reached from these: the
 * steps of yours, questions, approvals, flags, rhythms and suggestions are
 * all in On you; results to read, the context and drafts Dash found, and the
 * Claude steps waiting on an approval are on each goal's page; every run is
 * on /goals/runs, linked from What Dash did.
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
  /** YYYY-MM-DD in that zone, for how long an errand has left. */
  todayOn?: string;
  /** The week's four numbers; null when they could not be read. */
  health: WeekHealth | null;
  /** Your live areas, for the area an errand goes in; none when they could not be read. */
  areas?: { id: string; name: string; learn?: boolean }[];
  /** Each goal's holders by goal id (lib/goals/hand-off.ts). */
  holders?: Record<string, GoalHolders>;
  /** The runs going now. */
  working?: RunListing[];
  /** What Dash could take: goals it has left alone. */
  offers?: DashOffer[];
  /** The step ids on you that Dash could prepare. */
  preparable?: string[];
  /** The Dash has it lane. */
  dash?: DashLaneItem[];
  /** The Later lane. */
  laterOn?: LaterLaneItem[];
  /** Whether this account can start a run (the owner's only), which Ask Dash needs. */
  canRun?: boolean;
  /** The visit before the time away, on the day you came back from it; otherwise null. */
  awayFrom?: string | null;
};

export function HomeView({
  goals,
  today,
  later,
  done,
  brief,
  timeZone,
  todayOn,
  health,
  areas = [],
  holders = {},
  working = [],
  offers = [],
  preparable = [],
  dash = [],
  laterOn = [],
  canRun = false,
  awayFrom = null,
}: HomeViewProps) {
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
  const away = awayFrom && todayOn ? daysAway(awayFrom, todayOn) : null;
  const doneSection = <DoneSection done={done} timeZone={timeZone} />;
  const { errands, others } = splitErrands(goals);
  return (
    <div className="space-y-8">
      <section aria-labelledby="briefing-heading">
        <Card padding="standard" className="space-y-3">
          <div className="flex items-center gap-2">
            <DashMark size="sm" tone="brand" decorative />
            <h2 id="briefing-heading" className="text-ui font-semibold text-ink">
              Dash
            </h2>
            {brief?.when && <span className="text-small text-ink-muted">written {brief.when}</span>}
          </div>
          {away !== null && (
            <p className="text-body text-ink">
              Welcome back. You were away {away} days; here is what Dash did while you were gone,
              then what is on you.
            </p>
          )}
          {brief && (
            <div className="max-w-prose">
              <FileBody markdown={brief.body} />
            </div>
          )}
          {summary && (
            <p className={brief ? 'text-small text-ink-muted' : 'text-body text-ink'}>{summary}</p>
          )}
          <AskDash
            goals={goals.map(({ goal }) => ({ id: goal.id, title: goal.title }))}
            areas={areas}
            defaultAreaId={errandAreaDefault(errands, areas)}
          />
        </Card>
      </section>

      {away !== null && doneSection}

      {goals.length > 0 && (
        <GoalLanes
          goals={[...errands, ...others]}
          holders={holders}
          todayOn={todayOn}
          onYou={[...today, ...later]}
          preparable={preparable}
          dash={dash}
          laterOn={laterOn}
          working={working}
          offers={offers}
          canRun={canRun}
        />
      )}

      {away === null && doneSection}

      {away === null && <WeekSection health={health} />}
    </div>
  );
}

function DoneSection({ done, timeZone }: { done: DoneSince | null; timeZone: string }) {
  return (
    <section aria-labelledby="done-heading" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
        <h2 id="done-heading" className="text-ui font-semibold text-ink">
          <DashCredit className="text-ink-muted" />
          {done ? `What Dash did since ${formatInstant(done.since, timeZone)}` : 'What Dash did'}
        </h2>
        {/* Runs left the tab bar: an audit log, read from here when wanted. */}
        <Link href="/goals/runs" className="text-small text-accent underline-offset-2 hover:underline">
          Every run
        </Link>
      </div>
      {done && done.items.length > 0 ? (
        <DoneSinceList done={done} />
      ) : (
        <p className="px-1 text-small text-ink-muted">
          {done ? 'Nothing new since your last visit.' : 'This could not be read just now.'}
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
