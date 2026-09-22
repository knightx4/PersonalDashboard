import { redirect } from 'next/navigation';

/**
 * Five minutes became Practice Flow, which is now /learn itself. Kept as a
 * redirect so bookmarks and links written before either move still land on it.
 */
export default function FiveMinutesMovedPage() {
  redirect('/learn');
}
