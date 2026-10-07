import { requireUser } from '@/lib/auth/server';
import { loadWaiting } from '@/lib/todo/waiting/load';
import { WaitingView } from './waiting-view';

export const metadata = { title: 'Waiting' };

/**
 * What you are waiting on, by who has it (plan #1475; docs/CORE-AND-DASH-SPEC.md,
 * Part 4). The Agenda is what is on you; this is the other half, read live
 * from the workspaces that own each row. An application you sent sits here
 * under the company, and when they write back it leaves for the Agenda.
 *
 * No buttons: there is nothing to do about a thing someone else has, and
 * each row links to where it lives for when there is.
 */
export default async function WaitingPage() {
  const user = await requireUser();
  return <WaitingView waiting={await loadWaiting(user.id)} />;
}
