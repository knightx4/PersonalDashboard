import { redirect } from 'next/navigation';

/** The workspace opens on the list with work in it. */
export default function DevPage() {
  redirect('/dev/bugs');
}
