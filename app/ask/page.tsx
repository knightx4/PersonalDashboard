import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { Banner } from '@/components/ui/banner';
import { SectionFold } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { todayInTimezone } from '@/lib/money';
import { listAskConversations, loadAskMadeChanges } from '@/lib/talk/ask-request';
import type { MadeChange } from '@/lib/talk/changes';
import { AskButton, AskedWhen, AskMadeChanges } from './view';
import { DashCredit } from '@/components/ui/dash-mark';

export const metadata = { title: 'Questions to Dash' };

/**
 * Every question asked of Dash, the most recently added to first (plan
 * #1090). A row reopens the conversation to read it again or carry on.
 *
 * Above them, every change the person confirmed through Dash, newest first,
 * with Undo while it still stands (plan #1191). The changes come first
 * because they are the part of the page that can still be acted on; the
 * section is left out while there are none.
 */
export default async function AskPage() {
  const user = await requireUser();
  const [conversations, made, settings] = await Promise.all([
    listAskConversations(200),
    loadAskMadeChanges().then(
      (changes): { changes: MadeChange[]; failed?: true } => ({ changes }),
      (error: unknown) => {
        console.error('ask made changes were not read', error);
        return { changes: [], failed: true as const };
      },
    ),
    loadAccountSettings(user.id),
  ]);
  const today = todayInTimezone(settings.timezone);

  const questions = (
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
  );

  return (
    <>
      <PageHeader title="Questions to Dash" actions={<AskButton />} />
      {made.failed && (
        <Banner tone="bad" className="mb-4">
          The changes Dash made could not be read, so they are missing from this page. Reload to try
          again.
        </Banner>
      )}
      {conversations.length === 0 && made.changes.length === 0 ? (
        <EmptyState
          title="Nothing asked yet"
          description="Ask Dash about anything in your dashboard, from the Dash button at the top of any page or from ⌘K. Every question is kept here with its answer and the rows it used."
        />
      ) : (
        <div className="space-y-6">
          {made.changes.length > 0 && (
            <SectionFold title={<><DashCredit className="text-ink-muted" />Changes Dash made</>} count={made.changes.length}>
              <div className="mt-2">
                <AskMadeChanges changes={made.changes} today={today} />
              </div>
            </SectionFold>
          )}
          {conversations.length > 0 &&
            (made.changes.length > 0 ? (
              <SectionFold title="Questions" count={conversations.length}>
                <div className="mt-2">{questions}</div>
              </SectionFold>
            ) : (
              questions
            ))}
        </div>
      )}
    </>
  );
}
