import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/shell/page-header';
import { askTitle } from '@/lib/talk/talk';
import { countOpenAskHandoffs, loadAskChanges, loadAskConversation } from '@/lib/talk/ask-request';
import { AskConversation } from '../view';
import { rowSubject } from '@/lib/core/subject';
import { toRef } from '@/lib/core/refs';

export const metadata = { title: 'Question to Dash' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One question asked of Dash, reopened (plan #1090): the answer with the rows
 * it used, the changes it proposed as cards in their current state (#1190),
 * and the box to ask a follow-up in the same conversation.
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

  return (
    <>
      <PageHeader
        subject={await rowSubject(toRef('core.conversations', ref))}
        title={askTitle(first.body)}
      />
      <AskConversation
        conversationRef={ref}
        turns={turns}
        changes={changes}
        openHandoffs={openHandoffs}
      />
    </>
  );
}
