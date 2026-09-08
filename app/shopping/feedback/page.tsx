import { redirect } from 'next/navigation';

/**
 * The queue moved to its own workspace. Kept as a redirect rather than
 * deleted: this path is in bookmarks and in every "see all" link that shipped
 * before the move.
 */
export default function ShoppingFeedbackPage() {
  redirect('/dev/bugs');
}
