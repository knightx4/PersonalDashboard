'use client';

import { Users } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { ListPage, ListRow } from '@/components/patterns/list-detail';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/lib/jobs/applications/load';
import {
  heldOnLabel,
  meetingDayLabel,
  meetingState,
  meetingTitle,
  type BoardMeetingRow,
} from '@/lib/you/board';
import { useCallMeeting, type CallActions, type CallStart } from './call-meeting';
import { useRefreshWhileRunning } from './refresh-while-running';

/**
 * The Board tab's list (plan #2540.3): every meeting of the person's board,
 * newest first, on the list pattern (components/patterns/list-detail.tsx).
 * Each row says how far through the meeting's minutes they are, or that the
 * meeting is still being held, or that it failed; pressing it opens the
 * meeting's page.
 *
 * The header's one action calls a meeting about one decision (plan #2540.5):
 * it opens a line for the decision under the header, and a called meeting
 * then shows in the list running like any other.
 */
export function BoardListView({
  meetings,
  nextMeeting,
  timezone = 'UTC',
  now,
  actions,
  start,
}: {
  meetings: readonly BoardMeetingRow[];
  /** The day of the next weekly meeting in their zone (nextMeetingDay). */
  nextMeeting: string;
  timezone?: string;
  /** When the page was read, for whether a meeting is still running. */
  now: number;
  actions: CallActions;
  /** Where the press starts. Only the gallery sets it. */
  start?: CallStart;
}) {
  const states = meetings.map((meeting) => meetingState(meeting, now));
  const running = states.some((state) => state.kind === 'running');
  useRefreshWhileRunning(running);
  const call = useCallMeeting({ running, actions, start });
  const when = `The board meets every Sunday at 6:41 PM. The next meeting is ${meetingDayLabel(nextMeeting)}.`;
  const header = <PageHeader title="Board" actions={call.button} />;

  if (meetings.length === 0) {
    return (
      <PageColumn>
        {header}
        {call.form && <div className="mb-4">{call.form}</div>}
        <EmptyState
          icon={Users}
          title="No board meetings yet"
          description={`${when} Its minutes will be here, with the board's disagreements to vote on and its question to answer.`}
        />
      </PageColumn>
    );
  }

  return (
    <ListPage
      header={header}
      tools={call.form}
      foot={`${meetings.length} ${meetings.length === 1 ? 'meeting' : 'meetings'} · next ${meetingDayLabel(nextMeeting)}, 6:41 PM`}
    >
      {meetings.map((meeting, index) => {
        const state = states[index];
        const meta =
          state.kind === 'running'
            ? `Meeting now, started ${formatDateTime(state.since, timezone, now)}`
            : state.kind === 'failed'
              ? `Did not finish: ${state.error}`
              : progressLine(meeting.counts);
        return (
          <ListRow
            key={meeting.id}
            href={`/you/board/${meeting.id}`}
            title={meetingTitle(meeting)}
            meta={meeting.kind === 'called' ? `Called meeting · ${meta}` : meta}
            end={
              meeting.kind === 'called' && meeting.heldOn ? heldOnLabel(meeting.heldOn) : undefined
            }
          />
        );
      })}
    </ListPage>
  );
}

/** "1 of 3 voted · answered · 0 of 3 done", or that nothing is marked yet. */
export function progressLine(counts: BoardMeetingRow['counts']): string {
  const { disagreements, voted, resolutions, done, answered } = counts;
  if (!voted && !done && !answered) return 'Nothing marked yet';
  return [
    disagreements ? `${voted} of ${disagreements} voted` : null,
    answered ? 'question answered' : 'question not answered',
    resolutions ? `${done} of ${resolutions} done` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
