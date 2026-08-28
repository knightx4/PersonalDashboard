import { MessageSquarePlus } from 'lucide-react';
import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { FeedbackList, type FeedbackRow } from './feedback-list';

export const metadata = { title: 'Bugs and requests' };

export default async function FeedbackPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data } = await supabase
    .from('feedback_items')
    .select('id, kind, body, page_path, status, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200);

  const rows: FeedbackRow[] = (data ?? []).map((row) => ({
    id: row.id as string,
    kind: row.kind as FeedbackRow['kind'],
    body: row.body as string,
    pagePath: (row.page_path as string | null) ?? null,
    status: row.status as FeedbackRow['status'],
    createdAt: row.created_at as string,
  }));

  const open = rows.filter((row) => row.status === 'open');
  const rest = rows.filter((row) => row.status !== 'open');

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Bugs and requests"
        description="Everything captured from the header button. Mark items planned or done as they are picked up."
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={MessageSquarePlus}
          title="Nothing captured yet"
          description="Use the message button in the header to log a bug or an idea the moment you hit it."
        />
      ) : (
        <div className="space-y-6">
          {open.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-ink">
                Open <span className="font-normal text-ink-muted">({open.length})</span>
              </h2>
              <FeedbackList rows={open} />
            </section>
          )}
          {rest.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-ink">
                Triaged <span className="font-normal text-ink-muted">({rest.length})</span>
              </h2>
              <FeedbackList rows={rest} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
