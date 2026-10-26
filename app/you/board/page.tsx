import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createYouClient } from '@/lib/you/auth/server';
import { listBoardMeetings, nextMeetingDay } from '@/lib/you/board';
import { BoardListView } from './board-list-view';

export const metadata = { title: 'Board' };
export const dynamic = 'force-dynamic';

/** The time the page is read; outside the component, since reading the clock during render is unstable. */
function readAt(): number {
  return Date.now();
}

/**
 * You's Board tab (plan #2540.3): the board's meetings, newest first. Each
 * opens on its own page (./[id]), where the person reads the minutes and
 * marks them.
 */
export default async function Page() {
  const user = await requireUser();
  const [meetings, settings] = await Promise.all([
    listBoardMeetings(await createYouClient(), user.id),
    loadAccountSettings(user.id),
  ]);
  return (
    <BoardListView
      meetings={meetings}
      nextMeeting={nextMeetingDay(settings.timezone)}
      timezone={settings.timezone}
      now={readAt()}
    />
  );
}
