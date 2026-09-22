import { redirect } from 'next/navigation';

/**
 * Five minutes became Practice Flow and moved to /learn/flow. Kept as a
 * redirect so bookmarks and links written before the move still land on it.
 */
export default function FiveMinutesMovedPage() {
  redirect('/learn/flow');
}
