import { redirect } from 'next/navigation';
import { ACTIVITY_HREF } from '@/lib/jobs/home/now-tabs';

/**
 * Activity became a tab of Now in plan #1496.7.2, beside the overview whose
 * Since you last looked lists the newest of it. The address keeps working for
 * bookmarks and old links.
 */
export default function ActivityRedirect() {
  redirect(ACTIVITY_HREF);
}
