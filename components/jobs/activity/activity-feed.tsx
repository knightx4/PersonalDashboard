'use client';

import Link from 'next/link';
import { formatDate, formatDateTime } from '@/lib/jobs/applications/load';
import { groupByDay, type Activity, type ActivityEntry } from '@/lib/jobs/activity/load';

/** Where an entry came from, said in one word rather than a colour alone. */
const SOURCE_LABEL: Record<ActivityEntry['source'], string> = {
  email: 'inbox',
  auto: 'derived',
  sweep: 'nightly',
  you: 'you',
};

/**
 * What has changed lately.
 *
 * The counts a sync returns go into the cron's HTTP response and nowhere a
 * person can see, so a run that opened four roles overnight looked exactly
 * like one that did nothing. This shows the rows instead of the counts: what
 * the inbox wrote, what the nightly sweep closed, grouped by the day it
 * landed, each one a link to the role it happened to.
 *
 * It was a section buried in Settings, which is where you go to change
 * something, not to find out what happened. It is its own tab now, and this
 * is the whole of it.
 */
export function ActivityFeed({
  activity,
  timezone,
}: {
  activity: Activity;
  timezone: string;
}) {
  const days = groupByDay(activity.entries);
  const latestRun = activity.runs[0] ?? null;

  return (
    <div className="space-y-4">
      <section className="rounded-card border border-border bg-surface p-5">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-ink-muted">Last inbox sync</dt>
          <dd className="text-ink">
            {latestRun
              ? `${formatDateTime(latestRun.finishedAt ?? latestRun.startedAt, timezone)} · ${
                  latestRun.messagesSeen
                } read${latestRun.status === 'failed' ? ' · failed' : ''}`
              : 'Not yet'}
          </dd>

          <dt className="text-ink-muted">Nightly sweep</dt>
          <dd className="text-ink">
            {activity.lastSweepAt
              ? `Last changed something ${formatDateTime(activity.lastSweepAt, timezone)}`
              : 'Has not changed anything yet'}
          </dd>
        </dl>

        {latestRun?.error && (
          <p className="mt-3 rounded-lg bg-accent-orange-tint px-3 py-2 text-[12px] text-ink">
            Last run reported: {latestRun.error}
          </p>
        )}
      </section>

      {activity.entries.length === 0 ? (
        <p className="rounded-card border border-border bg-surface px-4 py-3 text-[13px] text-ink-muted">
          Nothing has changed yet. Once a scan has run, everything it writes shows up here.
        </p>
      ) : (
        <div className="space-y-4 rounded-card border border-border bg-surface p-5">
          {days.map((group) => (
            <div key={group.day}>
              <h2 className="text-[12px] font-medium text-ink-faint">
                {formatDate(group.entries[0].at, timezone)}
              </h2>
              <ul className="mt-1 divide-y divide-border">
                {group.entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5"
                  >
                    <span className="w-14 shrink-0 text-[11px] text-ink-faint">
                      {SOURCE_LABEL[entry.source]}
                    </span>
                    {entry.roleId ? (
                      <Link
                        href={`/jobs/roles/${entry.roleId}`}
                        className="text-[13px] text-ink first-letter:uppercase hover:text-brand"
                      >
                        {entry.headline}
                      </Link>
                    ) : (
                      <span className="text-[13px] text-ink first-letter:uppercase">
                        {entry.headline}
                      </span>
                    )}
                    {entry.detail && (
                      <span className="w-full text-[12px] text-ink-muted sm:w-auto sm:flex-1 sm:truncate">
                        {entry.detail}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
