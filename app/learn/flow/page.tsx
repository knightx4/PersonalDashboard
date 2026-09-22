import { redirect } from 'next/navigation';

/**
 * Practice Flow moved to /learn when it became what Learn opens on (plan
 * #773). Kept as a redirect so bookmarks and links written before the move
 * still land on it. The session, its actions and its state stay in this
 * folder beside it, imported by `app/learn/page.tsx`.
 */
export default function PracticeFlowMovedPage() {
  redirect('/learn');
}
