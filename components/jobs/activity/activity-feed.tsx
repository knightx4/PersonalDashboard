'use client';

import Link from 'next/link';
import { Activity as ActivityIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { APPLICATION_STATUS_GLYPHS } from '@/lib/status-glyphs';
import { formatDate, formatDateTime } from '@/lib/jobs/applications/load';
import { STAGE_INK } from './tone';
import {
  groupByDay,
  type Activity,
  type ActivityEntry,
  type ActivityHighlights,
} from '@/lib/jobs/activity/load';

/** Where an entry came from, said in one word rather than a colour alone. */
const SOURCE_LABEL: Record<ActivityEntry['source'], string> = {
  email: 'inbox',
  auto: 'derived',
  sweep: 'nightly',
  you: 'you',
};

/**
 * The week in four numbers.
 *
 * The feed answers "what happened" a row at a time, which is the right shape
 * for reading it and the wrong shape for the question you actually arrive
 * with: was this a week where anything moved. Four counts, in the order they
 * happen -- roles open, they move, they get rejected, they close.
 *
 * Plain ink, all four (plan #1755). They were tinted by tone, which made
 * "Moved forward" the offer green on a week with no offer in it. Two by two
 * on a phone, so the four take one short block and the first day of the
 * timeline still lands on the first screen.
 *
 * They are counted in the database over the window, not tallied from the
 * forty rows the feed shows, so a busy week reads correctly.
 */
function Highlights({ highlights }: { highlights: ActivityHighlights }) {
  const tiles: Array<{ label: string; value: number }> = [
    { label: 'New roles', value: highlights.newRoles },
    { label: 'Moved forward', value: highlights.movedForward },
    { label: 'Rejections', value: highlights.rejections },
    { label: 'Closed out', value: highlights.closedOut },
  ];

  return (
    <section aria-label={`The last ${highlights.days} days`}>
      {/* The card's own frame, with `bg-border` standing in for its fill so the
        * 1px grid gaps between the tiles are drawn by the ground showing
        * through. */}
      <Card padding="none" className="grid grid-cols-2 gap-px overflow-hidden bg-border sm:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="bg-surface px-4 py-3">
            <p className="text-micro uppercase tracking-wider text-ink-muted">{tile.label}</p>
            {/* Zero is grey: nothing happened is not news. */}
            <p
              className={cn(
                'font-display tabular mt-1 text-figure font-semibold tracking-tight',
                tile.value === 0 ? 'text-ink-muted' : 'text-ink',
              )}
            >
              {tile.value}
            </p>
          </div>
        ))}
      </Card>
      <p className="mt-1.5 text-small text-ink-muted">Last {highlights.days} days.</p>
    </section>
  );
}

/**
 * What a row says happened: the stage's glyph in the stage's ink, then the
 * label in ordinary ink. No tinted pill, so no row is green unless its stage
 * is the offer.
 */
function EntryLabel({ entry }: { entry: ActivityEntry }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-micro font-medium text-ink">
      {entry.stage ? (
        <StatusGlyph
          glyph={APPLICATION_STATUS_GLYPHS[entry.stage]}
          size={13}
          className={STAGE_INK[entry.stage]}
        />
      ) : (
        <span className="inline-block size-[13px]" aria-hidden />
      )}
      <span className="first-letter:uppercase">{entry.label}</span>
    </span>
  );
}

/**
 * What has changed lately.
 *
 * The counts a sync returns go into the cron's HTTP response and nowhere a
 * person can see, so a run that opened four roles overnight looked exactly
 * like one that did nothing. This shows the rows instead of the counts: what
 * the inbox wrote, what the nightly sweep closed, grouped by the day it
 * landed, each one a link to the role it happened to.
 *
 * The timeline comes straight after the counts, and the two lines on when the
 * inbox and the sweep last ran go under it: they answer "is it working",
 * which is the question you have once the timeline has not answered yours.
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
      <Highlights highlights={activity.highlights} />

      {activity.entries.length === 0 ? (
        <EmptyState
          icon={ActivityIcon}
          title="Nothing has changed yet"
          description="The inbox reads your mail and opens or moves roles; the nightly sweep closes what has gone quiet. Everything either one changes shows up here."
          action={{ label: 'Inbox settings', href: '/jobs/settings#inboxes' }}
        />
      ) : (
        <Card padding="standard" className="space-y-4">
          {days.map((group) => (
            <div key={group.day}>
              <h2 className="text-small font-medium text-ink-muted">
                {formatDate(group.entries[0].at, timezone)}
              </h2>
              <ul className="mt-1 divide-y divide-border">
                {group.entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="row-pad flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                  >
                    <span className="w-14 shrink-0 text-small text-ink-muted">
                      {SOURCE_LABEL[entry.source]}
                    </span>
                    <EntryLabel entry={entry} />
                    {/* On a phone the role always takes its own line, so a
                        short label does not pull it up beside itself and every
                        role starts at the same edge. */}
                    {entry.subject &&
                      (entry.roleId ? (
                        <Link
                          href={`/jobs/roles/${entry.roleId}`}
                          className="press-area w-full text-ui text-ink transition-colors duration-quick hover:text-accent sm:w-auto"
                        >
                          {entry.subject}
                        </Link>
                      ) : (
                        <span className="w-full text-ui text-ink sm:w-auto">{entry.subject}</span>
                      ))}
                    {/* Its own line at every width, never truncated: the
                        detail is often the one fact worth reading, such as an
                        interview's time. */}
                    {entry.detail && (
                      <span className="w-full text-small text-ink-muted sm:pl-16">
                        {entry.detail}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Card>
      )}

      <Card padding="standard">
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
      </Card>
    </div>
  );
}
