import { createClient, requireUser } from '@/lib/auth/server';
import { ConversationChat } from '@/components/patterns/conversation';
import { Markdown } from '@/components/ui/markdown';
import { CHATS_BACK } from '../view';

export const metadata = { title: 'Writing style' };

type WritingStyleRow = {
  body: string;
  read_from: string;
  messages_read: number;
  updated_at: string;
};

/**
 * Dash's Writing style page: how the person writes, read from the email they
 * sent (core.writing_style). A session writes the row; the page only shows
 * it, and nothing else reads it yet. It sits beside the chats, so on a phone
 * it is drawn over the list with the way back above its title.
 */
export default async function WritingStylePage() {
  await requireUser();
  const client = await createClient();
  // The request's own session: core.writing_style is read under RLS.
  const { data, error } = await client
    .schema('core')
    .from('writing_style')
    .select('body, read_from, messages_read, updated_at')
    .maybeSingle();
  const row = data as WritingStyleRow | null;

  return (
    <ConversationChat title="Writing style" back={CHATS_BACK} fill>
      <div className="mx-auto w-full max-w-3xl py-4">
        {error ? (
          <p className="text-small text-danger">Your writing style could not be read. Reload to try again.</p>
        ) : row ? (
          <>
            <p className="mb-4 text-small text-ink-muted">
              {row.read_from}: {row.messages_read} messages read. Written{' '}
              {new Date(row.updated_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.
            </p>
            <Markdown markdown={row.body} className="vault-prose" />
          </>
        ) : (
          <p className="text-small text-ink-muted">
            Dash has not written up your writing style yet.
          </p>
        )}
      </div>
    </ConversationChat>
  );
}
