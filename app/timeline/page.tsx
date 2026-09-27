import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { createClient, requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isOwner } from '@/lib/dev/owner';
import { switchableModules } from '@/lib/modules';
import { latestEventBefore, readTimeline } from '@/lib/timeline/load';
import { readObservations } from '@/lib/timeline/observations-load';
import {
  groupByMonth,
  isMonthKey,
  monthKeyOf,
  monthWindow,
  parseTimelineModule,
  shiftMonth,
  MONTHS_PER_PAGE,
} from '@/lib/timeline/months';
import { TIMELINE_MODULES } from '@/lib/timeline/timeline';
import { TimelineView } from './view';

export const metadata = { title: 'Timeline' };

/**
 * What you did across the app, month by month, newest first (plan #1118).
 * Read from core.timeline, which reads the tables each workspace already
 * keeps; a workspace switched off under Account is left out, as it is on
 * home.
 *
 * `?module=` narrows it to one workspace and `?to=YYYY-MM` names the last of
 * the twelve months shown, for going back past a year.
 */
export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ module?: string; to?: string }>;
}) {
  const user = await requireUser();
  const [params, settings, owner, client] = await Promise.all([
    searchParams,
    loadAccountSettings(user.id),
    isOwner({ user }),
    // The request's own session: core.timeline is security_invoker.
    createClient(),
  ]);

  const switchedOn = switchableModules(settings.enabledModules, owner);
  const modules = TIMELINE_MODULES.filter((id) => switchedOn.includes(id));
  const narrowed = parseTimelineModule(params.module, modules);
  const reading = narrowed ? [narrowed] : modules;

  const timezone = settings.timezone;
  const current = monthKeyOf(new Date().toISOString(), timezone);
  const to = isMonthKey(params.to) && params.to < current ? params.to : null;
  const window = monthWindow(to ?? current, timezone);

  const [events, before, noticed] =
    reading.length === 0
      ? [[], null, []]
      : await Promise.all([
          readTimeline(client, { from: window.from, to: window.to, modules: reading, newestFirst: true }),
          latestEventBefore(client, window.from, reading),
          // The weekly observations (plan #1120), by the month their week
          // begins in. A failed read costs the page these, not the months.
          readObservations(client, {
            fromWeek: `${window.first}-01`,
            toWeek: `${shiftMonth(window.last, 1)}-01`,
          }).catch(() => []),
        ]);
  // Narrowed to one workspace, only what that workspace is part of.
  const observations = narrowed ? noticed.filter((observation) => observation.modules.includes(narrowed)) : noticed;

  const months = groupByMonth(events, timezone, window);
  const newerLast = to ? shiftMonth(to, MONTHS_PER_PAGE) : null;

  return (
    <>
      <PageHeader
        title="Timeline"
        description="What you did across the app, month by month."
        actions={
          <Link href={`/timeline/year/${current.slice(0, 4)}`} className="text-ui text-accent hover:underline">
            {`${current.slice(0, 4)} in review`}
          </Link>
        }
      />
      <TimelineView
        months={months}
        modules={modules}
        module={narrowed}
        to={to}
        // Straight to the month the next event is in, past any empty stretch.
        earlier={before ? monthKeyOf(before, timezone) : null}
        later={newerLast === null ? null : newerLast >= current ? 'now' : newerLast}
        timezone={timezone}
        observations={observations}
      />
    </>
  );
}
