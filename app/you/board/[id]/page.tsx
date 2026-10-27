import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createYouClient } from '@/lib/you/auth/server';
import { boardScorecard, loadBoardMeeting, meetingTitle } from '@/lib/you/board';
import { loadMeetingDebate } from '@/lib/you/board-debate';
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
  const [found, scorecard, settings] = await Promise.all([
    loadBoardMeeting(you, user.id, id),
    boardScorecard(you, user.id),
    loadAccountSettings(user.id),
  ]);
  if (!found) notFound();
  const debate = await loadMeetingDebate(you, user.id, id, found.minutes.agenda);
  return (
    <MeetingView
      meeting={found.meeting}
      minutes={found.minutes}
      marks={found.marks}
      debate={debate}
      scorecard={scorecard}
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
