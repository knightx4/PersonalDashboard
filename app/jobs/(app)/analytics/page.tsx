import { redirect } from 'next/navigation';

/**
 * Analytics was retired in plan #1496.7.1, after nobody opened it in a month
 * (plan #1496.3). The funnel on Now covers how far applications got. The
 * address keeps working for bookmarks and old links.
 */
export default function AnalyticsRedirect() {
  redirect('/jobs');
}
