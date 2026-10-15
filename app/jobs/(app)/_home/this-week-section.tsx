import { INTERVIEW_HORIZON_DAYS, type TodayBoard } from '@/lib/jobs/today/load';
import { Card } from '@/components/ui/card';
import { HomeSection } from './home-section';
import { TodayLists } from './this-week-lists';

/** Every interview, past and upcoming, which left the tab bar in plan #1591. */
export const INTERVIEWS_HREF = '/jobs/interviews';

/**
 * What is happening this week: the interviews coming up. First on Now.
 *
 * Mail waiting on a reply and the reminders are in the Jobs Inbox since plan
 * #1937.9, which is where what asks something of you lives; the nightly
 * sweep's nudges join them there while the setting asks for them.
 *
 * This was the whole of the This week page until Home took its place (plan
 * #1150). A clear week used to fill that page with the finished state; here it
 * is one quiet line, because the sections below it may still have something
 * to say.
 *
 * The page loads the board (loadToday) and hands it down, because the live
 * list counts the mail waiting on you as putting the move on you.
 */
export function ThisWeekSection({ board, timezone }: { board: TodayBoard; timezone: string }) {
  return (
    <HomeSection
      id="this-week"
      title="This week"
      more={{ href: INTERVIEWS_HREF, label: 'All interviews' }}
    >
      {board.interviews.length === 0 ? (
        <Card padding="dense">
          <p className="text-small text-ink-muted">No interviews in the next {INTERVIEW_HORIZON_DAYS} days.</p>
        </Card>
      ) : (
        <TodayLists board={board} timezone={timezone} />
      )}
    </HomeSection>
  );
}
