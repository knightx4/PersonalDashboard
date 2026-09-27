import { INTERVIEW_HORIZON_DAYS, type TodayBoard } from '@/lib/jobs/today/load';
import { HomeSection } from './home-section';
import { TodayLists } from './this-week-lists';

/**
 * What has to happen this week, and nothing else: interviews coming up, mail
 * waiting on a reply, and the nightly sweep's nudges.
 *
 * This was the whole of the This week page until Home took its place (plan
 * #1150). A clear week used to fill that page with the finished state; here it
 * is one quiet line, because the sections above it may still have something
 * to say. Lists with nothing in them are left out rather than shown as zero.
 *
 * The page loads the board (loadToday) and hands it down, because the section
 * above this one leaves out the mail this one lists as waiting on you.
 */
export function ThisWeekSection({ board, timezone }: { board: TodayBoard; timezone: string }) {
  return (
    <HomeSection
      id="this-week"
      title="This week"
      hint={board.clear ? undefined : 'The things with a clock on them, in the order they run out.'}
    >
      {board.clear ? (
        <p className="px-1 text-small text-ink-muted">
          Nothing needs you this week: no interviews in the next {INTERVIEW_HORIZON_DAYS} days,
          no mail waiting on a reply, and no nudges.
        </p>
      ) : (
        <TodayLists board={board} timezone={timezone} />
      )}
    </HomeSection>
  );
}
