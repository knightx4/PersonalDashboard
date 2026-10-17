import { NewDashChat } from '../view';

export const metadata = { title: 'Dash' };

/**
 * A new chat at an address of its own (note bd8b9a15). On a phone /ask is
 * the list of chats, so New chat pointing there went nowhere; here the new
 * chat is drawn over the list, with the way back above it.
 */
export default function NewAskPage() {
  return <NewDashChat />;
}
