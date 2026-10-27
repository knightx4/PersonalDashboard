'use client';

import { Users } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { ListRow } from '@/components/patterns/list-detail';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionLabel } from '@/components/ui/section-heading';
import { formatDateTime } from '@/lib/jobs/applications/load';
import {
  heldOnLabel,
  meetingDayLabel,
  meetingState,
  meetingTitle,
  type BoardMeetingRow,
  type MeetingState,
} from '@/lib/you/board';
import type { BoardAdvisor, BoardQuestion } from '@/lib/you/board-questions';
import { useAskBoard, type AskActions, type AskStart } from './ask-board';
import { AskedRow, SuggestionRow, type QuestionActions } from './question-rows';
import { useRefreshWhileRunning } from './refresh-while-running';

/**
 * The Board tab's list (plans #2540.3 and #2561.4), on the list pattern
 * (components/patterns/list-detail.tsx): the header's one action, Ask the
 * board, which opens the compose card under it; then one surface of rows in
 * three groups. The board's suggested questions come first, each with Ask
 * now, Save for Sunday and Dismiss; then the questions the person asked,
 * with the state each is in; then every meeting, newest first, each opening
 * on its own page (./[id]).
 */

export type BoardListActions = AskActions & QuestionActions;

export function BoardListView({
  meetings,
  questions = [],
  advisors = [],
  nextMeeting,
  timezone = 'UTC',
  now,
  actions,
  start,
}: {
  meetings: readonly BoardMeetingRow[];
  /** Their suggested and open questions (listBoardQuestions). */
  questions?: readonly BoardQuestion[];
  /** The active roster, for the compose card's advisors. */
  advisors?: readonly BoardAdvisor[];
  /** The day of the next weekly meeting in their zone (nextMeetingDay). */
  nextMeeting: string;
  timezone?: string;
  /** When the page was read, for whether a meeting is still running. */
  now: number;
  actions: BoardListActions;
  /** Where the press starts. Only the gallery sets it. */
  start?: AskStart;
}) {
  const states = meetings.map((meeting) => meetingState(meeting, now));
  const running = states.some((state) => state.kind === 'running');
  useRefreshWhileRunning(running);
  const ask = useAskBoard({ advisors, actions, start });
  const header = <PageHeader title="Board" actions={ask.button} />;
  const nextDay = meetingDayLabel(nextMeeting);

  const suggestions = questions.filter((q) => q.status === 'suggested');
  const asked = questions.filter((q) => q.status !== 'suggested');

  if (meetings.length === 0 && questions.length === 0) {
    return (
      <PageColumn>
        {header}
        {ask.form && <div className="mb-4">{ask.form}</div>}
        <EmptyState
          icon={Users}
          align="start"
          title="Nothing before the board yet"
          description={`The board meets every Sunday at 6:41 PM, next on ${nextDay.replace(/^\S+ /, '')}. Ask it a question to take up then, or have it meet now. Each meeting also suggests questions for you.`}
        />
      </PageColumn>
    );
  }

  /** The meeting a question is in: the one it names, or a called meeting about it still starting. */
  const meetingFor = (question: BoardQuestion): MeetingState | null => {
    const index = meetings.findIndex((m, i) =>
      question.meetingId
        ? m.id === question.meetingId
        : m.kind === 'called' && m.decision === question.question && states[i].kind === 'running',
    );
    return index >= 0 ? states[index] : null;
  };

  return (
    <PageColumn>
      {header}
      {ask.form && <div className="mb-4">{ask.form}</div>}
      <Card padding="none">
        <ul className="divide-y divide-border">
          {suggestions.length > 0 && (
            <Group title="Suggested by the board" count={suggestions.length}>
              {suggestions.map((question) => (
                <SuggestionRow key={question.id} question={question} actions={actions} />
              ))}
            </Group>
          )}
          {asked.length > 0 && (
            <Group title="Your questions" count={asked.length}>
              {asked.map((question) => (
                <AskedRow
                  key={question.id}
                  question={question}
                  meeting={meetingFor(question)}
                  roster={advisors}
                  nextMeeting={nextDay}
                  timezone={timezone}
                  now={now}
                  actions={actions}
                  notice={ask.notice?.questionId === question.id ? ask.notice.error : null}
                />
              ))}
            </Group>
          )}
          {meetings.length > 0 && (
            <Group title="Meetings" count={meetings.length}>
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
                      meeting.kind === 'called' && meeting.heldOn
                        ? heldOnLabel(meeting.heldOn)
                        : undefined
                    }
                  />
                );
              })}
            </Group>
          )}
        </ul>
      </Card>
      <div className="mt-3 text-small text-ink-muted">
        {`Next meeting ${nextDay}, 6:41 PM`}
      </div>
    </PageColumn>
  );
}

/** One group of the surface: its label, then its rows. */
function Group({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <li>
      <SectionLabel as="h2" count={count} className="card-pad-x pb-1 pt-3">
        {title}
      </SectionLabel>
      <ul className="divide-y divide-border">{children}</ul>
    </li>
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
