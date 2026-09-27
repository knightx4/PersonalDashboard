import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { listAskConversations } from '@/lib/talk/ask-request';
import { AskButton, AskedWhen } from './view';

export const metadata = { title: 'Questions to Dash' };

/**
 * Every question asked of Dash, the most recently added to first (plan
 * #1090). A row reopens the conversation to read it again or carry on.
 */
export default async function AskPage() {
  const conversations = await listAskConversations(200);

  return (
    <>
      <PageHeader title="Questions to Dash" actions={<AskButton />} />
      {conversations.length === 0 ? (
        <EmptyState
          title="Nothing asked yet"
          description="Ask Dash about anything in your dashboard, from the Dash button at the top of any page or from ⌘K. Every question is kept here with its answer and the rows it used."
        />
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <Link
                href={`/ask/${conversation.ref}`}
                className="flex items-baseline gap-3 px-1 py-2.5 hover:bg-sunken"
              >
                <span className="min-w-0 flex-1 truncate text-body text-ink">
                  {conversation.title ?? 'A question'}
                </span>
                <span className="tabular shrink-0 text-small text-ink-muted">
                  <AskedWhen at={conversation.lastAt} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
