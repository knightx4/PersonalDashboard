import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createYouClient } from '@/lib/you/auth/server';
import { boardScorecard, loadBoardMeeting, meetingTitle } from '@/lib/you/board';
import { loadMeetingDebate } from '@/lib/you/board-debate';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { todayInTimezone } from '@/lib/money';
import { createTodoClient } from '@/lib/todo/auth/server';
import { loadGoalChoices, withMade } from '@/lib/you/board-make-store';
import { advisorNames, listMeetingReviews, loadPickScorecard } from '@/lib/you/board-reviews';
import { makeDecisionHappen } from '../make-actions';
import { MeetingView } from './meeting-view';

export const metadata = { title: 'Board meeting' };
export const dynamic = 'force-dynamic';

/** The time the page is read; outside the component, since reading the clock during render is unstable. */
function readAt(): number {
  return Date.now();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One board meeting (plan #2540.3): its minutes, the person's marks on them,
 * the scorecard counted across every meeting, and the debate held on each
 * question it took up (plan #2561.5), read after the minutes since their
 * agenda gives the questions' order.
 *
 * The path is written here rather than read from the catalogue
 * (lib/core/subject.ts): board meetings are not a source (lib/you/sources.ts),
 * so the catalogue has no section for them.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requireUser();
  const you = await createYouClient();
  const [found, scorecard, settings, reviews, picks, names] = await Promise.all([
    loadBoardMeeting(you, user.id, id),
    boardScorecard(you, user.id),
    loadAccountSettings(user.id),
    listMeetingReviews(you, user.id, id),
    loadPickScorecard(you, user.id),
    advisorNames(you, user.id),
  ]);
  if (!found) notFound();
  const loaded = await loadMeetingDebate(you, user.id, id, found.minutes.agenda);
  const decided = loaded.questions.some((q) => q.decision?.kind === 'option');
  const [todo, goals] = decided ? await Promise.all([createTodoClient(), createGoalsClient()]) : [null, null];
  const debate = todo && goals ? await withMade(you, { todo, goals }, user.id, loaded) : loaded;
  const goalChoices = goals ? await loadGoalChoices(goals, user.id) : [];
  return (
    <MeetingView
      meeting={found.meeting}
      minutes={found.minutes}
      marks={found.marks}
      debate={debate}
      make={{ action: makeDecisionHappen, goals: goalChoices, today: todayInTimezone(settings.timezone) }}
      scorecard={scorecard}
      reviews={reviews}
      picks={picks}
      names={names}
      timezone={settings.timezone}
      now={readAt()}
      subject={{
        ref: null,
        path: [
          { label: 'You', href: '/you' },
          { label: 'Board', href: '/you/board' },
          { label: meetingTitle(found.meeting), href: `/you/board/${id}` },
        ],
      }}
    />
  );
}
