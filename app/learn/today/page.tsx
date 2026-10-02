import { redirect } from 'next/navigation';
import { practiceHref } from '@/lib/learn/flow/href';

/**
 * Five minutes became Practice Flow (plan #805), which is now the Practice
 * only switch on Now (plan #1486). Kept as a redirect so bookmarks and links
 * written before any of the moves still land on the questions.
 */
export default function FiveMinutesMovedPage() {
  redirect(practiceHref());
}
