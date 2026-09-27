import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { askTitle } from '@/lib/talk/talk';
import { loadAskConversation } from '@/lib/talk/ask-request';
import { AskConversation } from '../view';

export const metadata = { title: 'Question to Dash' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One question asked of Dash, reopened (plan #1090): the answer with the rows
 * it used, and the box to ask a follow-up in the same conversation.
 */
export default async function AskConversationPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;
  if (!UUID.test(ref)) notFound();
  const turns = await loadAskConversation(ref);
  // Not there, or not theirs: RLS answers both with nothing.
  if (turns.length === 0) notFound();
  const first = turns.find((turn) => turn.role === 'user') ?? turns[0];

  return (
    <>
      <Link
        href="/ask"
        className="mb-2 inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
        Questions to Dash
      </Link>
      <PageHeader title={askTitle(first.body)} />
      <AskConversation conversationRef={ref} turns={turns} />
    </>
  );
}
