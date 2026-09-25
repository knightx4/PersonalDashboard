import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Flag, Repeat } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isOwner } from '@/lib/dev/owner';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { missedLine, progressLine, type Practice } from '@/lib/goals/rhythms';
import { areaRunView, type AreaRunView } from '@/lib/goals/shaping';
import { loadAreaRuns } from '@/lib/goals/shaping-store';
import { loadDailyView } from '@/lib/goals/steps-store';
import { todayIn } from '@/lib/todo/tasks/model';
import { AreaPlanner } from '../../area-planner';
import { GoalRow } from '../../daily-view';
import { ApproveArea } from '../../goals-view';

export const metadata = { title: 'Area' };
export const dynamic = 'force-dynamic';

/**
 * One area (docs/GOALS-SPEC.md, "The three levels"): a direction that never
 * finishes, and what serves it. What you want from it, the goals under it
 * (each an outcome, with its bar and weekly verdict), the goals Claude
 * proposed for it, and its practices: the rhythms inside its goals, with
 * this period's progress. Plan this area asks Claude for what is missing.
 * Naming the area and writing its note stay on All goals.
 */

/** The area's latest planning run as its line reads it. Outside the component because it reads the clock. */
function runLine(runs: Awaited<ReturnType<typeof loadAreaRuns>>, areaId: string): AreaRunView | null {
  const run = runs[areaId];
  return run ? areaRunView(run, Date.now()) : null;
}

export default async function AreaPage({ params }: { params: Promise<{ areaId: string }> }) {
  const { areaId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(areaId)) notFound();
  const user = await requireUser();
  const [account, client] = await Promise.all([loadAccountSettings(user.id), createGoalsClient()]);
  const [area, daily, runs, canRun] = await Promise.all([
    client.from('areas').select('id, name, note').eq('id', areaId).is('archived_at', null).maybeSingle(),
    loadDailyView(client, { userId: user.id, today: todayIn(account.timezone) }),
    loadAreaRuns(client).catch(() => ({})),
    isOwner({ user }),
  ]);
  if (area.error || !area.data) notFound();
  const name = area.data.name as string;
  const note = (area.data.note as string | null) ?? null;

  const goals = daily.goals.filter((d) => d.goal.areaId === areaId);
  const goalIds = new Set(goals.map((d) => d.goal.id));
  const proposed = daily.waiting.flatMap((item) =>
    item.kind === 'plan' && item.id === areaId ? item.goals : [],
  );
  const practices = daily.practices.filter((p) => goalIds.has(p.goalId));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/goals/all"
          className="mb-3 inline-flex items-center gap-1.5 text-ui text-ink-muted transition-colors duration-150 hover:text-ink"
        >
          <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden /> All goals
        </Link>
        <PageHeader title={name} description={note ?? 'What you want from this area is not written yet. Add it on All goals.'} />
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
            Proposed by Claude
          </h2>
          {proposed.length > 1 && <ApproveArea areaId={areaId} count={proposed.length} />}
          <Card>
            <ul className="divide-y divide-border">
              {proposed.map((goal) => (
                <li key={goal.id}>
                  <Link
                    href={`/goals/${goal.id}`}
                    className="card-pad-x row-pad flex items-start gap-2 transition-colors duration-150 hover:bg-sunken"
                  >
                    <Flag className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
                    <span className="min-w-0 flex-1 text-ui break-words text-ink">{goal.title}</span>
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

      <AreaPlanner areaId={areaId} hasGoals={goals.length + proposed.length > 0} run={runLine(runs, areaId)} canRun={canRun} />
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
        className="card-pad-x row-pad flex items-start gap-2 transition-colors duration-150 hover:bg-sunken"
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
