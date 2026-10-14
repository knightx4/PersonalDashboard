import { notFound } from 'next/navigation';
import { askTitle } from '@/lib/talk/talk';
import { countOpenAskHandoffs, loadAskChanges, loadAskChatCost, loadAskConversation } from '@/lib/talk/ask-request';
import { chatFiles, chatLookups, chatReadRows } from '@/lib/talk/chat-trail';
import { AskConversation } from '../view';

export const metadata = { title: 'Dash' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One chat with Dash, open beside the list (plans #1090, #1899.2): the
 * answers with the rows they used, the changes Dash proposed as cards in
 * their current state (#1190), and the box to carry on, with what Dash used
 * in it in the column beside (#1899.4). On a phone it is drawn over the
 * list, with the way back above its title.
 */
export default async function AskConversationPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;
  if (!UUID.test(ref)) notFound();
  const [turns, changes, openHandoffs] = await Promise.all([
    loadAskConversation(ref),
    loadAskChanges(ref),
    countOpenAskHandoffs(ref).catch(() => 0),
  ]);
  // Not there, or not theirs: RLS answers both with nothing.
  if (turns.length === 0) notFound();
  const first = turns.find((turn) => turn.role === 'user') ?? turns[0];
  const costMicros = await loadAskChatCost(turns);

  return (
    <AskConversation
      title={askTitle(first.body)}
      conversationRef={ref}
      turns={turns}
      changes={changes}
      openHandoffs={openHandoffs}
      used={{
        rows: chatReadRows(turns),
        changes,
        lookups: chatLookups(turns),
        files: chatFiles(turns),
        costMicros,
      }}
    />
  );
}
