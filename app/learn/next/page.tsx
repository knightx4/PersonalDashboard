import { redirect } from 'next/navigation';

/**
 * Learn next was folded into Practice Flow (plan #773). The flow asks the
 * re-checks it listed, and offers the readings it listed after an answer, so
 * the list itself went. Kept as a redirect so old links land on the flow.
 */
export default function LearnNextMovedPage() {
  redirect('/learn');
}
