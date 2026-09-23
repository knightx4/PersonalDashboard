import { redirect } from 'next/navigation';

/**
 * Learn next was folded into Practice Flow (plan #773). The flow asks the
 * re-checks it listed; the readings it listed are on Learn now (plan #805).
 * Kept as a redirect to Learn now, because a list of what to do next is closer
 * to Learn now's feed than to one question at a time.
 */
export default function LearnNextMovedPage() {
  redirect('/learn/now');
}
