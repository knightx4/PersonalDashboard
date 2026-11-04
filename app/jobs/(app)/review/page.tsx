import { redirect } from 'next/navigation';
import { jobsInboxViewHref } from '@/app/jobs/(app)/inbox/review-cards';
import { parseReviewView } from '@/lib/jobs/review/load';

/**
 * Review folded into the Jobs Inbox (plan #1496.7.3), which lists every
 * import to check with its own buttons and the same narrowing by kind. The
 * address keeps working for bookmarks and old links, keeping its view. The
 * queue's writes stay in actions.ts in this folder, which the Inbox's rows,
 * the role page and Dash all call.
 */
export default async function ReviewRedirect({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  redirect(jobsInboxViewHref(parseReviewView(view)));
}
