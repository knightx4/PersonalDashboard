import { INTERVIEW_HORIZON_DAYS, type TodayBoard } from '@/lib/jobs/today/load';
import { HomeSection } from './home-section';
import { TodayLists } from './this-week-lists';

/** Every interview, past and upcoming, which left the tab bar in plan #1591. */
export const INTERVIEWS_HREF = '/jobs/interviews';

/**
 * The interviews coming up, on Now.
 *
 * This was the whole of the This week page until Home took its place (plan
 * #1150). The mail waiting on a reply and the reminders went to the Jobs
 * Inbox when Today split into Now and Inbox (plan #1937.9), and the nudges
 * with them; what is left is the week's diary. A clear week is one quiet
 * line, because the sections below it may still have something to say.
 */
export function ThisWeekSection({ board, timezone }: { board: TodayBoard; timezone: string }) {
  return (
    <HomeSection
      id="this-week"
      title="This week"
      more={{ href: INTERVIEWS_HREF, label: 'All interviews' }}
    >
      {board.interviews.length === 0 ? (
        <p className="px-1 text-small text-ink-muted">
          No interviews in the next {INTERVIEW_HORIZON_DAYS} days.
        </p>
      ) : (
        <TodayLists board={board} timezone={timezone} />
      )}
    </HomeSection>
  );
}
