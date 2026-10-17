import { NewDashChat } from './view';

export const metadata = { title: 'Dash' };

/**
 * Dash's page (plans #1090, #1899.2). The layout draws the list of chats;
 * at /ask itself the chat beside it is a new one. On a phone the list is the
 * whole page here, and New chat opens /ask/new over it.
 */
export default function AskPage() {
  return <NewDashChat />;
}
