'use client';

import { useState } from 'react';
import { MessageSquare, Play, StickyNote } from 'lucide-react';
import Link from '@/components/ui/link';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { DashCredit, DashMark } from '@/components/ui/dash-mark';
import { LinkedText } from '@/components/ui/linked-text';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { TONE_TEXT, type DevTone } from '@/components/dev/state-label';
import { cn } from '@/lib/cn';
import { exactTime } from '@/lib/comments/when';
import { formatClock } from '@/lib/clock';
import {
  activityDays,
  dayHeading,
  type ActivityEntry,
  type ActivityKind,
} from '@/lib/plan/activity';
import { PLAN_UPDATE_HEALTH, progressSince } from '@/lib/plan/updates';
import type { StatusGlyph as GlyphName } from '@/lib/status-glyphs';

/** How many entries show before "Show all". */
export const ACTIVITY_SHOWN = 40;

/** The lifecycle entries draw the plan's own status glyph for where they left the row. */
const KIND_GLYPH: Partial<Record<ActivityKind, { glyph: GlyphName; tone: DevTone }>> = {
  added: { glyph: 'empty', tone: 'quiet' },
  started: { glyph: 'three-quarters', tone: 'info' },
  blocked: { glyph: 'bar', tone: 'caution' },
  closed: { glyph: 'full', tone: 'positive' },
  dropped: { glyph: 'slash', tone: 'quiet' },
  answered: { glyph: 'check', tone: 'positive' },
};

const RUN_END: Record<string, string> = {
  started: 'still going',
  finished: 'finished',
  failed: 'did not finish',
};

/**
 * The Activity tab on a feature's page (plan #1667): what happened to the
 * feature and every row beneath it, newest first under a heading per day.
 * Each entry links to the row it is about, on Overview for the feature and
 * its questions and on the Steps tab for a step.
 */
export function FeatureActivity({ entries }: { entries: readonly ActivityEntry[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? entries : entries.slice(0, ACTIVITY_SHOWN);
  const days = activityDays(shown);

  return (
    <div className="max-w-2xl space-y-5">
      {days.map(({ day, entries: onDay }) => (
        <section key={day} aria-label={dayHeading(day)}>
          <h2 className="mb-2 text-small font-semibold uppercase tracking-wide text-ink-muted">
            {dayHeading(day)}
          </h2>
          <ol className={cn(cardVariants(), 'divide-y divide-border')}>
            {onDay.map((entry) => (
              <ActivityRow key={entry.id} entry={entry} />
            ))}
          </ol>
        </section>
      ))}
      {!all && entries.length > ACTIVITY_SHOWN && (
        <Button variant="secondary" size="sm" onClick={() => setAll(true)}>
          Show all {entries.length}
        </Button>
      )}
    </div>
  );
}

function ActivityMark({ entry }: { entry: ActivityEntry }) {
  if (entry.update) {
    const health = PLAN_UPDATE_HEALTH[entry.update.health];
    return <StatusGlyph glyph={health.glyph} className={TONE_TEXT[health.tone]} />;
  }
  const glyph = KIND_GLYPH[entry.kind];
  if (glyph) return <StatusGlyph glyph={glyph.glyph} className={TONE_TEXT[glyph.tone]} />;
  if (entry.kind === 'comment' && entry.who === 'dash') return <DashMark size="2xs" decorative />;
  if (entry.kind === 'dash') return <DashMark size="2xs" decorative />;
  const Icon = entry.kind === 'run' ? Play : entry.kind === 'comment' ? MessageSquare : StickyNote;
  return <Icon aria-hidden className="size-3.5 text-ink-muted" strokeWidth={2} />;
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const subject = (
    <Link
      href={entry.subject.href}
      className="font-medium text-ink underline-offset-2 hover:underline"
    >
      {entry.subject.isFeature ? 'this feature' : `#${entry.subject.number} ${entry.subject.title}`}
    </Link>
  );

  let line: React.ReactNode;
  if (entry.update) {
    line = <>Dash’s update: {PLAN_UPDATE_HEALTH[entry.update.health].word}</>;
  } else if (entry.kind === 'dash') {
    line = entry.subject.isFeature ? (
      entry.verb
    ) : (
      <>
        {entry.verb}{' '}
        <Link
          href={entry.subject.href}
          className="text-ink-muted underline-offset-2 hover:underline"
        >
          Open #{entry.subject.number}
        </Link>
      </>
    );
  } else {
    line = (
      <>
        {entry.verb} {subject}
        {entry.runStatus && <span className="text-ink-muted">, {RUN_END[entry.runStatus]}</span>}
      </>
    );
  }
  const byDash =
    entry.who === 'dash' && !['comment', 'update', 'run', 'dash'].includes(entry.kind);

  return (
    <li className="flex gap-3 px-4 py-3">
      <span className="flex h-5 shrink-0 items-center">
        <ActivityMark entry={entry} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-ui text-ink">
          {line}
          {byDash && (
            <span className="ml-2 whitespace-nowrap text-small text-ink-muted">
              <DashCredit />
              by Dash
            </span>
          )}
        </p>
        {entry.detail && (
          <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-small text-ink-muted">
            <LinkedText text={entry.detail} />
          </p>
        )}
        {entry.update && (
          <p className="mt-1 text-small text-ink-muted">{progressSince(entry.update)}</p>
        )}
        {entry.sha && (
          <p className="mt-1 text-small text-ink-muted">
            Commit <span className="font-mono">{entry.sha.slice(0, 8)}</span>
          </p>
        )}
      </div>
      {!entry.dayOnly && (
        <time
          dateTime={entry.at}
          title={exactTime(entry.at)}
          className="shrink-0 whitespace-nowrap pt-px text-right text-small tabular-nums text-ink-muted"
        >
          {formatClock(entry.at, { timeZone: 'UTC' })}
        </time>
      )}
    </li>
  );
}
