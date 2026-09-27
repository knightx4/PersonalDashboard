import { redirect } from 'next/navigation';

/**
 * This week became a section of the Jobs home (plan #1150). The address keeps
 * working for bookmarks and old links.
 */
export default function ThisWeekRedirect() {
  redirect('/jobs');
}
