import { redirect } from 'next/navigation';

/** The workspace opens on Dash, which carries everything waiting on you. */
export default function DevPage() {
  redirect('/dev/raised');
}
