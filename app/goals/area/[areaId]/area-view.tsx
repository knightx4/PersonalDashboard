import Link from 'next/link';
import { ArrowLeft, Flag, Repeat } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { DashCredit } from '@/components/ui/dash-mark';
import type { DailyGoal } from '@/lib/goals/daily';
import { missedLine, progressLine, type Practice } from '@/lib/goals/rhythms';
import type { AreaRunView } from '@/lib/goals/shaping';
import { AreaPlanner } from '../../area-planner';
import { ApproveArea } from '../../goals-view';
import { GoalRow } from './area-goal-row';

/**
 * One area's page as it draws, from what its page read (plan #1601): the
 * goals under it, the goals Dash proposed for it, its practices and the
 * planner. The gallery draws it from fixtures.
 */
export function AreaView({
  areaId,
  name,
  note,
  goals,
  proposed,
  practices,
  run,
  canRun,
}: {
  areaId: string;
  name: string;
  note: string | null;
  goals: DailyGoal[];
  proposed: { id: string; title: string }[];
  practices: Practice[];
  run: AreaRunView | null;
  canRun: boolean;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/goals/all"
          className="press-area mb-3 inline-flex items-center gap-1.5 text-ui text-ink-muted transition-colors duration-quick hover:text-ink"
        >
          <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden /> All goals
        </Link>
        <PageHeader
          title={name}
          description={
            note ?? 'What you want from this area is not written yet. Add it on All goals.'
          }
        />
      </div>

      <section aria-labelledby="area-goals-heading" className="space-y-2">
        <h2 id="area-goals-heading" className="px-1 text-ui font-semibold text-ink">
          Goals
        </h2>
        {goals.length > 0 ? (
          <Card>
            <ul className="divide-y divide-border">
              {goals.map((d) => (
                <GoalRow key={d.goal.id} daily={d} />
              ))}
            </ul>
          </Card>
        ) : (
          <p className="px-1 text-small text-ink-muted">No goals you have approved yet.</p>
        )}
      </section>

      {proposed.length > 0 && (
        <section aria-labelledby="area-proposed-heading" className="space-y-2">
          <h2 id="area-proposed-heading" className="px-1 text-ui font-semibold text-ink">
            <DashCredit className="text-ink-muted" />
            Proposed by Dash
          </h2>
          {proposed.length > 1 && <ApproveArea areaId={areaId} count={proposed.length} />}
          <Card>
            <ul className="divide-y divide-border">
              {proposed.map((goal) => (
                <li key={goal.id}>
                  <Link
                    href={`/goals/${goal.id}`}
                    className="card-pad-x row-pad flex items-start gap-2 transition-colors duration-quick hover:bg-sunken"
                  >
                    <Flag
                      className="mt-0.5 size-4 shrink-0 text-ink-muted"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 text-ui break-words text-ink">
                      {goal.title}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {practices.length > 0 && (
        <section aria-labelledby="area-practices-heading" className="space-y-2">
          <div className="px-1">
            <h2 id="area-practices-heading" className="text-ui font-semibold text-ink">
              Practices
            </h2>
            <p className="text-small text-ink-muted">
              What you keep doing for these goals. Each lives inside the goal it serves.
            </p>
          </div>
          <Card>
            <ul className="divide-y divide-border">
              {practices.map((practice) => (
                <PracticeRow key={practice.id} practice={practice} />
              ))}
            </ul>
          </Card>
        </section>
      )}

      <AreaPlanner
        areaId={areaId}
        hasGoals={goals.length + proposed.length > 0}
        run={run}
        canRun={canRun}
      />
    </div>
  );
}

function PracticeRow({ practice }: { practice: Practice }) {
  const line = [
    progressLine(practice.period, { count: practice.count, target: practice.target }),
    practice.missed > 0 ? missedLine(practice.period, practice.missed) : null,
    `For ${practice.goalTitle}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li>
      <Link
        href={`/goals/${practice.goalId}`}
        className="card-pad-x row-pad flex items-start gap-2 transition-colors duration-quick hover:bg-sunken"
      >
        <Repeat className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-ui break-words text-ink">{practice.title}</span>
          <span className="block text-small break-words text-ink-muted">{line}</span>
        </span>
      </Link>
    </li>
  );
}
