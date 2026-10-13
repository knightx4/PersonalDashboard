'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Timeline, type TimelineEntry, type TimelineKind } from '@/components/ui/timeline';
import type { ActivityEntry, ActivityKind } from '@/lib/plan/activity';
import { PLAN_UPDATE_HEALTH, progressSince, type PlanUpdateHealth } from '@/lib/plan/updates';
import { stepRef } from '@/lib/plan/ref';

/** How many entries show before "Show all". */
export const ACTIVITY_SHOWN = 40;

/** Which timeline mark each kind of entry takes. The marks themselves are in components/ui/timeline.tsx. */
const KIND_MARK: Record<ActivityKind, TimelineKind> = {
  added: 'note',
  started: 'started',
  blocked: 'blocked',
  closed: 'done',
  dropped: 'dropped',
  answered: 'done',
  note: 'note',
  comment: 'note',
  run: 'started',
  update: 'note',
  dash: 'note',
};

const HEALTH_MARK: Record<PlanUpdateHealth, TimelineKind> = {
  on_track: 'done',
  at_risk: 'waiting',
  blocked: 'blocked',
};

const RUN_END: Record<string, string> = {
  started: 'still going',
  finished: 'finished',
  failed: 'did not finish',
};

const RUN_MARK: Record<string, TimelineKind> = {
  started: 'started',
  finished: 'done',
  failed: 'blocked',
};

/**
 * The Activity tab on a feature's page (plan #1667): what happened to the
 * feature and every row beneath it, newest first on the shared timeline.
 * Each entry links to the row it is about, on Overview for the feature and
 * its questions and on the Steps tab for a step.
 */
export function FeatureActivity({ entries }: { entries: readonly ActivityEntry[] }) {
  const [all, setAll] = useState(false);
  const drawn = useMemo(
    () => (all ? entries : entries.slice(0, ACTIVITY_SHOWN)).map(toTimelineEntry),
    [entries, all],
  );

  return (
    // As wide as the tabs, as Overview and Steps are (plan #1688).
    <div className="space-y-5">
      <Timeline entries={drawn} empty="Nothing has happened here yet." />
      {!all && entries.length > ACTIVITY_SHOWN && (
        <Button variant="secondary" size="sm" onClick={() => setAll(true)}>
          Show all {entries.length}
        </Button>
      )}
    </div>
  );
}

function toTimelineEntry(entry: ActivityEntry): TimelineEntry {
  const subjectName = entry.subject.isFeature
    ? 'this feature'
    : `${stepRef(entry.subject)} ${entry.subject.title}`;
  const byDash =
    entry.who === 'dash' && !['comment', 'update', 'run', 'dash'].includes(entry.kind);

  let title: string;
  if (entry.update) {
    title = `Dash’s update: ${PLAN_UPDATE_HEALTH[entry.update.health].word}`;
  } else if (entry.kind === 'dash') {
    title = entry.verb;
  } else {
    title = `${entry.verb} ${subjectName}`;
    if (entry.runStatus) title += `, ${RUN_END[entry.runStatus]}`;
  }
  if (byDash) title += ' by Dash';

  const body = [
    entry.detail,
    entry.update ? progressSince(entry.update) : null,
    entry.sha ? `Commit ${entry.sha.slice(0, 8)}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const kind = entry.update
    ? HEALTH_MARK[entry.update.health]
    : entry.runStatus
      ? (RUN_MARK[entry.runStatus] ?? 'started')
      : KIND_MARK[entry.kind];

  return {
    id: entry.id,
    time: entry.at,
    dayOnly: entry.dayOnly,
    kind,
    title,
    body: body || undefined,
    voice:
      entry.who === 'you' ? 'you' : entry.who === 'dash' || entry.update ? 'dash' : undefined,
    link: {
      href: entry.subject.href,
      label: entry.subject.isFeature ? 'Open feature' : `Open ${stepRef(entry.subject)}`,
    },
  };
}
