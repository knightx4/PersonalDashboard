import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isOwner } from '@/lib/dev/owner';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { areaRunView, type AreaRunView } from '@/lib/goals/shaping';
import { loadAreaRuns } from '@/lib/goals/shaping-store';
import { loadDailyView } from '@/lib/goals/steps-store';
import { todayIn } from '@/lib/todo/tasks/model';
import { AreaView } from './area-view';

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
function runLine(
  runs: Awaited<ReturnType<typeof loadAreaRuns>>,
  areaId: string,
): AreaRunView | null {
  const run = runs[areaId];
  return run ? areaRunView(run, Date.now()) : null;
}

export default async function AreaPage({ params }: { params: Promise<{ areaId: string }> }) {
  const { areaId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(areaId)) notFound();
  const user = await requireUser();
  const [account, client] = await Promise.all([loadAccountSettings(user.id), createGoalsClient()]);
  const [area, daily, runs, canRun] = await Promise.all([
    client
      .from('areas')
      .select('id, name, note')
      .eq('id', areaId)
      .is('archived_at', null)
      .maybeSingle(),
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
    <AreaView
      areaId={areaId}
      name={name}
      note={note}
      goals={goals}
      proposed={proposed}
      practices={practices}
      run={runLine(runs, areaId)}
      canRun={canRun}
    />
  );
}
