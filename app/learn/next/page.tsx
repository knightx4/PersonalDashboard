import { redirect } from 'next/navigation';

/**
 * Learn next was folded into Practice Flow (plan #773). The flow asks the
 * re-checks it listed; the readings it listed are on Now (plan #805). Kept as
 * a redirect to Now (plan #1486), whose strip at the top lists what is
 * waiting, as Learn next once did.
 */
export default function LearnNextMovedPage() {
  redirect('/learn/now');
}
