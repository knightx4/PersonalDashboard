import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createYouClient } from '@/lib/you/auth/server';
import { listBoardMeetings, nextMeetingDay } from '@/lib/you/board';
import { listBoardAdvisors, listBoardQuestions, listDecisions } from '@/lib/you/board-questions';
import { listPanels } from '@/lib/you/board-panels';
import { listBoardAsks } from '@/lib/you/board-asks';
import { advisorNames, listOpenReviews } from '@/lib/you/board-reviews';
import {
  acceptSuggestion,
  answerBoardAsk,
  askBoard,
  conveneQuestion,
  dismissSuggestion,
  startMeeting,
} from './actions';
import { answerBoardReview, answerBoardTripwire } from './review-actions';
import { listDueTripwires } from '@/lib/you/board-tripwires';
import { loadTrackRecords } from '@/lib/you/board-scoring';
import { BoardListView } from './board-list-view';

export const metadata = { title: 'Board' };
export const dynamic = 'force-dynamic';

/** The time the page is read; outside the component, since reading the clock during render is unstable. */
function readAt(): number {
  return Date.now();
}

/**
 * You's Board tab (plans #2540.3 and #2561.4): Ask the board, the board's
 * suggested questions, the questions asked, and the meetings newest first.
 * Each meeting opens on its own page (./[id]), where the person reads the
 * minutes and marks them. The board's check-backs on their decisions wait
 * here for their answer (plan #2561.8), first on the tab once due, with the
 * tripwires whose day has come and each advisor's track record (#2581.10).
 */
export default async function Page() {
  const user = await requireUser();
  const client = await createYouClient();
  const [meetings, questions, asks, reviews, names, decisions, advisors, panels, settings, tripwires, records] =
    await Promise.all([
      listBoardMeetings(client, user.id),
      listBoardQuestions(client, user.id),
      listBoardAsks(client, user.id),
      listOpenReviews(client, user.id),
      advisorNames(client, user.id),
      listDecisions(client, user.id),
      listBoardAdvisors(client, user.id),
      listPanels(client, user.id),
      loadAccountSettings(user.id),
      listDueTripwires(client, user.id),
      loadTrackRecords(client, user.id),
    ]);
  return (
    <BoardListView
      meetings={meetings}
      questions={questions}
      asks={asks}
      reviews={reviews}
      tripwires={tripwires}
      records={records}
      names={names}
      advisors={advisors}
      panels={panels}
      decisions={decisions}
      nextMeeting={nextMeetingDay(settings.timezone)}
      timezone={settings.timezone}
      now={readAt()}
      actions={{
        ask: askBoard,
        start: startMeeting,
        accept: acceptSuggestion,
        dismiss: dismissSuggestion,
        convene: conveneQuestion,
        answerAsk: answerBoardAsk,
        answerReview: answerBoardReview,
        answerTripwire: answerBoardTripwire,
      }}
    />
  );
}
