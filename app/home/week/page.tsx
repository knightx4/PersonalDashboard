import { WeekPage } from './week-page';

export const metadata = { title: 'The week in review' };
export const dynamic = 'force-dynamic';

/** The newest weekly review (plan #1233), linked from the home page. */
export default async function LatestWeekPage() {
  return <WeekPage week={null} />;
}
