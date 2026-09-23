import { redirect } from 'next/navigation';

/**
 * Five minutes became Practice Flow, which now lives at /learn/flow (plan
 * #805). Kept as a redirect so bookmarks and links written before any of the
 * moves still land on the questions.
 */
export default function FiveMinutesMovedPage() {
  redirect('/learn/flow');
}
