import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { greetingFor } from '@/lib/shell/greeting';
import { NewDashChat } from './view';

export const metadata = { title: 'Dash' };

/**
 * Dash's page (plans #1090, #1899.2). The layout draws the list of chats;
 * at /chat/dash itself the chat beside it is a new one, opening on a
 * greeting by the time of day where the person is and their name (plan
 * #2863). On a phone the list is the whole page here, and New chat
 * (/chat/dash?chat=new) opens this over it.
 */
export default async function AskPage() {
  const user = await requireUser();
  const settings = await loadAccountSettings(user.id);
  return <NewDashChat greeting={greetingFor(settings.timezone, new Date(), settings.displayName)} />;
}
