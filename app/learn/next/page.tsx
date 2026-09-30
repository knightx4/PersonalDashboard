import { redirect } from 'next/navigation';

/**
 * Learn next was folded into Practice Flow (plan #773). The flow asks the
 * re-checks it listed; the readings it listed are on Learn now (plan #805).
 * Kept as a redirect to Home (plan #1313), whose "Waiting for you" card is a
 * list of what to do next and links on to Learn now and the reviews.
 */
export default function LearnNextMovedPage() {
  redirect('/learn/home');
}
