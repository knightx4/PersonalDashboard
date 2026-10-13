import { redirect } from 'next/navigation';

/**
 * Career goals became a part of Find (plan #1589, decision #1585), then
 * moved to Settings when Find was cut back to finding roles, companies and
 * people. The address keeps working for bookmarks and old links.
 */
export default function CareerGoalsRedirect() {
  redirect('/jobs/settings#career-goals');
}
