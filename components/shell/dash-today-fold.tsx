import { Suspense, type ReactNode } from 'react';
import { undoDashToday } from '@/app/home/actions';
import { DashTodayGroups } from '@/app/home/dash-today';
import { HomeFold } from '@/app/home/home-fold';
import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { zoneDay } from '@/lib/core/when';
import type { ModuleId } from '@/lib/modules';
import { loadDashToday, type DashTodayGroup } from '@/lib/shell/dash-today';
import { changesLabel, dashTodayCount } from '@/lib/shell/dash-today-count';

/**
 * "What Dash did today" as one fold, wherever it is read (plan #1964.4).
 *
 * Home draws every workspace's changes through it, and each workspace's Now
 * draws its own: the same rows, the same count on the fold line and the same
 * Undo on each, filtered by workspace in `loadDashToday`. It is absent on a
 * day Dash changed nothing there, so it takes no placeholder either.
 */
export function DashTodayFold({
  groups,
  timezone,
  action,
  className,
}: {
  groups: readonly DashTodayGroup[];
  timezone: string;
  /** A link opposite the title, such as a workspace's list of every run. */
  action?: ReactNode;
  /** Spacing round the fold; not drawn on a day with nothing to show. */
  className?: string;
}) {
  const count = dashTodayCount(groups);
  if (count === 0) return null;
  const fold = (
    <HomeFold id="dash-today" title="What Dash did today" count={changesLabel(count)} action={action}>
      <DashTodayGroups groups={groups} timezone={timezone} undo={undoDashToday} />
    </HomeFold>
  );
  return className ? <div className={className}>{fold}</div> : fold;
}

/**
 * The fold on a workspace's Now: reads that workspace's changes itself, so a
 * page drops it in a Suspense and passes nothing but the workspace. A read
 * that fails leaves the fold out, as an empty day does.
 */
export async function WorkspaceDashToday({
  workspace,
  action,
  className,
}: {
  workspace: ModuleId;
  action?: ReactNode;
  className?: string;
}) {
  const user = await requireUser();
  const core = await createCoreClient();
  const { timezone } = await loadAccountSettings(user.id, core);
  const groups = await loadDashToday(core, {
    userId: user.id,
    today: zoneDay(new Date(), timezone),
    timezone,
    workspace,
  }).catch(() => []);
  return <DashTodayFold groups={groups} timezone={timezone} action={action} className={className} />;
}

/**
 * The fold as a Now page places it: streamed in its own Suspense with
 * nothing to show while it reads, so the page never waits on it.
 */
export function NowDashToday({
  workspace,
  action,
  className = 'mt-6',
}: {
  workspace: ModuleId;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Suspense fallback={null}>
      <WorkspaceDashToday workspace={workspace} action={action} className={className} />
    </Suspense>
  );
}
