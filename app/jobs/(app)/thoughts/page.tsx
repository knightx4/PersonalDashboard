import { redirect } from 'next/navigation';

/**
 * Career goals became a part of Find (plan #1589, decision #1585). The
 * address keeps working for bookmarks and old links.
 */
export default function CareerGoalsRedirect() {
  redirect('/jobs/find');
}
