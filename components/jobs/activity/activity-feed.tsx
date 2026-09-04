'use client';

import Link from 'next/link';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime } from '@/lib/jobs/applications/load';
import {
  groupByDay,
  type Activity,
  type ActivityEntry,
  type ActivityTone,
} from '@/lib/jobs/activity/load';

/** Where an entry came from, said in one word rather than a colour alone. */
const SOURCE_LABEL: Record<ActivityEntry['source'], string> = {
  email: 'inbox',
  auto: 'derived',
  sweep: 'nightly',
  you: 'you',
};

/**
 * The tone, as a tinted chip.
 *
 * These are the pipeline's own status colours rather than new ones: a
 * rejection is the same red here as it is on the board, and every pair is
 * already checked by scripts/check-contrast.ts in all five themes. The chip
 * carries a word, never a colour alone -- the colour is what makes the one
 * line you were looking for findable, not what tells you which line it is.
 */
const TONE_CHIP: Record<ActivityTone, string> = {
  bad: 'bg-status-rejected-tint text-status-rejected',
  good: 'bg-status-offer-tint text-status-offer',
  info: 'bg-status-submitted-tint text-status-submitted',
  muted: 'bg-status-lead-tint text-status-lead',
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
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-ui">
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
          <p className="mt-3 rounded-lg bg-caution-tint px-3 py-2 text-small text-ink">
            Last run reported: {latestRun.error}
          </p>
        )}
      </section>

      {activity.entries.length === 0 ? (
        <p className="rounded-card border border-border bg-surface px-4 py-3 text-ui text-ink-muted">
          Nothing has changed yet. Once a scan has run, everything it writes shows up here.
        </p>
      ) : (
        <div className="space-y-4 rounded-card border border-border bg-surface p-5">
          {days.map((group) => (
            <div key={group.day}>
              <h2 className="text-small font-medium text-ink-muted">
                {formatDate(group.entries[0].at, timezone)}
              </h2>
              <ul className="mt-1 divide-y divide-border">
                {group.entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5"
                  >
                    <span className="w-14 shrink-0 text-micro text-ink-muted">
                      {SOURCE_LABEL[entry.source]}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 self-center rounded-full px-2 py-0.5 text-micro font-medium first-letter:uppercase',
                        TONE_CHIP[entry.tone],
                      )}
                    >
                      {entry.label}
                    </span>
                    {entry.subject &&
                      (entry.roleId ? (
                        <Link
                          href={`/jobs/roles/${entry.roleId}`}
                          className="text-ui text-ink hover:text-accent"
                        >
                          {entry.subject}
                        </Link>
                      ) : (
                        <span className="text-ui text-ink">{entry.subject}</span>
                      ))}
                    {entry.detail && (
                      <span className="w-full text-small text-ink-muted sm:w-auto sm:flex-1 sm:truncate">
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
