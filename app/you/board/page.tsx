import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createYouClient } from '@/lib/you/auth/server';
import { listBoardMeetings, nextMeetingDay } from '@/lib/you/board';
import { listBoardAdvisors, listBoardQuestions, listDecisions } from '@/lib/you/board-questions';
import { listBoardAsks } from '@/lib/you/board-asks';
import { acceptSuggestion, answerBoardAsk, askBoard, conveneQuestion, dismissSuggestion } from './actions';
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
 * minutes and marks them.
 */
export default async function Page() {
  const user = await requireUser();
  const client = await createYouClient();
  const [meetings, questions, asks, decisions, advisors, settings] = await Promise.all([
    listBoardMeetings(client, user.id),
    listBoardQuestions(client, user.id),
    listBoardAsks(client, user.id),
    listDecisions(client, user.id),
    listBoardAdvisors(client, user.id),
    loadAccountSettings(user.id),
  ]);
  return (
    <BoardListView
      meetings={meetings}
      questions={questions}
      asks={asks}
      advisors={advisors}
      decisions={decisions}
      nextMeeting={nextMeetingDay(settings.timezone)}
      timezone={settings.timezone}
      now={readAt()}
      actions={{
        ask: askBoard,
        accept: acceptSuggestion,
        dismiss: dismissSuggestion,
        convene: conveneQuestion,
        answerAsk: answerBoardAsk,
      }}
    />
  );
}
