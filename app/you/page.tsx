import { redirect } from 'next/navigation';

/** You opens on Personality, its first tab (plan #1991.1). */
export default function YouPage() {
  redirect('/you/personality');
}
