import { INTERVIEW_HORIZON_DAYS, type TodayBoard } from '@/lib/jobs/today/load';
import { HomeSection } from './home-section';
import { TodayLists } from './this-week-lists';

/** Every interview, past and upcoming, which left the tab bar in plan #1591. */
export const INTERVIEWS_HREF = '/jobs/interviews';

/**
 * What has to happen this week, and nothing else: interviews coming up,
 * rounds owing a debrief, mail waiting on a reply, and the nightly sweep's
 * nudges. First on Today.
 *
 * This was the whole of the This week page until Home took its place (plan
 * #1150). A clear week used to fill that page with the finished state; here it
 * is one quiet line, because the sections below it may still have something
 * to say. Lists with nothing in them are left out rather than shown as zero.
 *
 * The page loads the board (loadToday) and hands it down, because "Since you
 * last looked" leaves out the mail this one lists as waiting on you, and the
 * live list counts that mail as putting the move on you.
 */
export function ThisWeekSection({ board, timezone }: { board: TodayBoard; timezone: string }) {
  return (
    <HomeSection
      id="this-week"
      title="This week"
      more={{ href: INTERVIEWS_HREF, label: 'All interviews' }}
    >
      {board.clear ? (
        <p className="px-1 text-small text-ink-muted">
          Nothing needs you this week: no interviews in the next {INTERVIEW_HORIZON_DAYS} days,
          no debriefs owed, no mail waiting on a reply, and no nudges.
        </p>
      ) : (
        <TodayLists board={board} timezone={timezone} />
      )}
    </HomeSection>
  );
}
