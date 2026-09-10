'use client';

import Link from 'next/link';
import { Activity as ActivityIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDate, formatDateTime } from '@/lib/jobs/applications/load';
import {
  groupByDay,
  type Activity,
  type ActivityEntry,
  type ActivityHighlights,
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
 * already checked by scripts/check-contrast.ts in all four themes. The chip
 * carries a word, never a colour alone -- the colour is what makes the one
 * line you were looking for findable, not what tells you which line it is.
 *
 * ui-ok-file: stage-tint-without-glyph -- a tone on a line of history, not a
 * status chip. The four here say what happened to a role, not which stage it
 * is in, and each one is read off the word in the chip rather than the ground
 * behind it. The glyph belongs on the badge, which is what says the stage.
 */
const TONE_CHIP: Record<ActivityTone, string> = {
  bad: 'bg-status-rejected-tint text-status-rejected',
  good: 'bg-status-offer-tint text-status-offer',
  info: 'bg-status-submitted-tint text-status-submitted',
  muted: 'bg-status-lead-tint text-status-lead',
};

/** The same four tones as a figure on a plain surface, with no tint behind. */
const TONE_FIGURE: Record<ActivityTone, string> = {
  bad: 'text-status-rejected',
  good: 'text-status-offer',
  info: 'text-status-submitted',
  muted: 'text-ink',
};

/**
 * The week in four numbers.
 *
 * The feed answers "what happened" a row at a time, which is the right shape
 * for reading it and the wrong shape for the question you actually arrive
 * with: was this a week where anything moved. Four counts, in the order they
 * happen -- roles open, they move, they get rejected, they close -- each one
 * tinted with the same tone the matching rows below carry.
 *
 * They are counted in the database over the window, not tallied from the
 * forty rows the feed shows, so a busy week reads correctly.
 */
function Highlights({ highlights }: { highlights: ActivityHighlights }) {
  const tiles: Array<{ label: string; value: number; tone: ActivityTone }> = [
    { label: 'New roles', value: highlights.newRoles, tone: 'info' },
    { label: 'Moved forward', value: highlights.movedForward, tone: 'good' },
    { label: 'Rejections', value: highlights.rejections, tone: 'bad' },
    { label: 'Closed out', value: highlights.closedOut, tone: 'muted' },
  ];

  return (
    <section aria-label={`The last ${highlights.days} days`}>
      {/* The card's own frame, with `bg-border` standing in for its fill so the
        * 1px grid gaps between the tiles are drawn by the ground showing
        * through. Hand-written until the sweep, which meant four tiles in a box
        * that was not the box every other card on the page is. */}
      <Card padding="none" className="grid gap-px overflow-hidden bg-border sm:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="bg-surface px-4 py-3">
            <p className="text-micro uppercase tracking-wider text-ink-muted">{tile.label}</p>
            {/* Zero is grey whatever the tone: nothing happened is not news,
             * and four coloured noughts would say it was. */}
            <p
              className={cn(
                'font-display tabular mt-1 text-figure font-semibold tracking-tight',
                tile.value === 0 ? 'text-ink-muted' : TONE_FIGURE[tile.tone],
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
      <Highlights highlights={activity.highlights} />

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

      {activity.entries.length === 0 ? (
        <EmptyState
          icon={ActivityIcon}
          title="Nothing has changed yet"
          description="Once a scan has run, everything it writes shows up here."
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
                          className="text-ui text-ink transition-colors duration-150 hover:text-accent"
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
        </Card>
      )}
    </div>
  );
}
